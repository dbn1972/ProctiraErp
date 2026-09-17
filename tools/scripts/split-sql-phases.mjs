#!/usr/bin/env node
/**
 * Split a SQL file into executable statement phases for W1-DATA-05 non-txn resume.
 *
 * Usage:
 *   node tools/scripts/split-sql-phases.mjs <input.sql> <out-dir>
 *
 * Writes zero-padded phase files: 000.sql, 001.sql, …
 * Skips empty / comment-only chunks. Handles -- and block comments,
 * single-quoted strings, and PostgreSQL dollar-quoting ($tag$…$tag$).
 *
 * Exit 0 on success. Prints phase count to stdout.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function splitSqlPhases(sql) {
  const phases = [];
  let i = 0;
  let start = 0;
  const n = sql.length;

  const pushPhase = (end) => {
    const raw = sql.slice(start, end);
    if (phaseHasExecutableSql(raw)) {
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
  const phases = splitSqlPhases(sql);
  mkdirSync(outDir, { recursive: true });
  phases.forEach((body, idx) => {
    const name = String(idx).padStart(3, '0') + '.sql';
    writeFileSync(join(outDir, name), body, 'utf8');
  });
  process.stdout.write(String(phases.length) + '\n');
}

const isDirect = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirect) main(process.argv);
