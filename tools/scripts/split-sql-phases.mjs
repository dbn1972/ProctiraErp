#!/usr/bin/env node
/**
 * Split a SQL file into executable statement phases for W1-DATA-05 non-txn resume.
 *
 * Usage:
 *   node tools/scripts/split-sql-phases.mjs <input.sql> <out-dir>
 *
 * Writes zero-padded phase files: 000.sql, 001.sql, …
 * Skips empty / comment-only chunks. Handles -- and block comments,
 * single-quoted strings (including E'…' backslash-escaped strings),
 * double-quoted identifiers ("a;b"), and PostgreSQL dollar-quoting
 * ($tag$…$tag$).
 *
 * Phase files are intended for non-transactional (CONCURRENTLY) resume, where
 * each statement must stand alone. Explicit transaction control
 * (BEGIN/START TRANSACTION/COMMIT/ROLLBACK/END/SAVEPOINT) and BEGIN ATOMIC
 * routine bodies cannot be safely split per-statement, so they are refused
 * fail-closed (exit non-zero) rather than silently mis-split.
 *
 * Exit 0 on success. Prints phase count to stdout. Exit 1 on refused input.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export class SqlPhaseSplitError extends Error {}

export function splitSqlPhases(sql) {
  const phases = [];
  let i = 0;
  let start = 0;
  const n = sql.length;

  const pushPhase = (end) => {
    const raw = sql.slice(start, end);
    if (phaseHasExecutableSql(raw)) {
      assertNoTransactionControl(raw);
      phases.push(raw.trimEnd() + '\n');
    }
    start = end;
  };

  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    // Line comment
    if (c === '-' && next === '-') {
      i += 2;
      while (i < n && sql[i] !== '\n') i += 1;
      continue;
    }

    // Block comment
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n - 1 && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i = Math.min(i + 2, n);
      continue;
    }

    // E'…' escape string: backslashes escape the next char (incl. \' and \\).
    if ((c === 'E' || c === 'e') && next === "'") {
      i += 2;
      while (i < n) {
        if (sql[i] === '\\') {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // Single-quoted string ('' escape)
    if (c === "'") {
      i += 1;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // Double-quoted identifier ("" escape); a ';' inside must not split.
    if (c === '"') {
      i += 1;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // Dollar-quoted string: $tag$ ... $tag$
    if (c === '$') {
      const tagMatch = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        i += tag.length;
        const close = sql.indexOf(tag, i);
        i = close === -1 ? n : close + tag.length;
        continue;
      }
    }

    if (c === ';') {
      pushPhase(i + 1);
      i += 1;
      start = i;
      continue;
    }

    i += 1;
  }

  if (start < n) {
    pushPhase(n);
  }

  return phases;
}

/**
 * Refuse transaction-control statements and BEGIN ATOMIC bodies in phase
 * files: splitting them per-statement would run them non-atomically and
 * corrupt the phase ledger. Fail closed rather than mis-split.
 */
export function assertNoTransactionControl(chunk) {
  // Strip comments and string/identifier literals so keywords inside them
  // (e.g. a comment mentioning COMMIT) do not trigger a false positive.
  const code = stripSqlNoise(chunk);
  const txnControl =
    /\b(BEGIN\s+ATOMIC|BEGIN\s+(?:WORK|TRANSACTION|ISOLATION)|START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT|RELEASE\s+SAVEPOINT)\b/i;
  // A bare `BEGIN;` (transaction start) — but not `BEGIN` that opens a
  // PL/pgSQL block, which is always preceded by `$tag$` / `AS`/`LANGUAGE`.
  const bareBegin = /(^|;|\s)BEGIN\s*;/i;
  const match = txnControl.exec(code) || bareBegin.exec(code);
  if (match) {
    throw new SqlPhaseSplitError(
      `Refusing to split phase file: transaction control / BEGIN ATOMIC is not permitted in CONCURRENTLY phase files (found "${match[0].trim()}"). Each phase statement must stand alone.`,
    );
  }
}

function stripSqlNoise(chunk) {
  let out = '';
  let i = 0;
  const n = chunk.length;
  while (i < n) {
    const c = chunk[i];
    const next = chunk[i + 1];
    if (c === '-' && next === '-') {
      i += 2;
      while (i < n && chunk[i] !== '\n') i += 1;
      out += ' ';
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n - 1 && !(chunk[i] === '*' && chunk[i + 1] === '/')) i += 1;
      i = Math.min(i + 2, n);
      out += ' ';
      continue;
    }
    if ((c === 'E' || c === 'e') && next === "'") {
      i += 2;
      while (i < n) {
        if (chunk[i] === '\\') {
          i += 2;
          continue;
        }
        if (chunk[i] === "'") {
          if (chunk[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      out += " '' ";
      continue;
    }
    if (c === "'") {
      i += 1;
      while (i < n) {
        if (chunk[i] === "'") {
          if (chunk[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      out += " '' ";
      continue;
    }
    if (c === '"') {
      i += 1;
      while (i < n) {
        if (chunk[i] === '"') {
          if (chunk[i + 1] === '"') {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      out += ' "x" ';
      continue;
    }
    if (c === '$') {
      const tagMatch = chunk.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        i += tag.length;
        const close = chunk.indexOf(tag, i);
        i = close === -1 ? n : close + tag.length;
        out += ' $q$ ';
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

export function phaseHasExecutableSql(chunk) {
  let i = 0;
  const n = chunk.length;
  while (i < n) {
    const c = chunk[i];
    const next = chunk[i + 1];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === '-' && next === '-') {
      i += 2;
      while (i < n && chunk[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n - 1 && !(chunk[i] === '*' && chunk[i + 1] === '/')) i += 1;
      i = Math.min(i + 2, n);
      continue;
    }
    return true;
  }
  return false;
}

function main(argv) {
  const input = argv[2];
  const outDir = argv[3];
  if (!input || !outDir) {
    console.error('Usage: node split-sql-phases.mjs <input.sql> <out-dir>');
    process.exit(2);
  }
  const sql = readFileSync(input, 'utf8');
  let phases;
  try {
    phases = splitSqlPhases(sql);
  } catch (err) {
    if (err instanceof SqlPhaseSplitError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  mkdirSync(outDir, { recursive: true });
  phases.forEach((body, idx) => {
    const name = String(idx).padStart(3, '0') + '.sql';
    writeFileSync(join(outDir, name), body, 'utf8');
  });
  process.stdout.write(String(phases.length) + '\n');
}

const isDirect = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirect) main(process.argv);
