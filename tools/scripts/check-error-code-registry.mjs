#!/usr/bin/env node
/**
 * V15-19 — every error code on the wire must be in the registry.
 *
 * `ERROR_CODE_REGISTRY` held ten entries and had one runtime consumer, which serves it as
 * documentation at `/api/v1/meta/error-codes`. Its own test asserted only that it covered
 * the `ErrorCode` enum — so it was "exhaustive" against an enum while the gateway emitted
 * **41** distinct codes, of which seven overlapped. `TENANT_REQUIRED`, with 424 emit sites
 * and the most common rejection the platform produces, was not in it. A published registry
 * that omits the codes a client will actually receive cannot be used to branch, which makes
 * it worse than no registry: it looks authoritative.
 *
 * This script re-derives the wire codes from source and fails when one is unregistered, or
 * when a registered code is emitted with a status the registry does not claim.
 *
 * ## Why the scan looks for `statusCode` nearby
 *
 * `code:` is also an ordinary domain field in this codebase — subject codes, grade codes,
 * board codes. A naive scan for `code: 'UPPER_SNAKE'` returns 111 matches including `MATH`,
 * `CBSE`, `AY25` and `TUITION`. Requiring `statusCode` within the surrounding lines selects
 * the error-envelope position specifically and drops all of those: 111 → 41. The envelope is
 * defined by `code` + `message` + `statusCode`, so this is the shape, not a heuristic guess.
 *
 * Usage
 *   node tools/scripts/check-error-code-registry.mjs
 *   node tools/scripts/check-error-code-registry.mjs --json
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Source trees that can put a code on the wire. */
export const SCAN_ROOTS = ['apps/api-gateway/src', 'packages/backend'];

const REGISTRY_FILE = 'packages/shared/common/src/constants/error-code-registry.ts';

/**
 * Codes emitted by a gateway dependency rather than by this repository's own envelope, or
 * emitted only as a re-export of a registered code. Each needs a reason, and the gate fails
 * if an entry here is no longer found — a stale waiver is a lie with a comment on it.
 */
export const WAIVED_CODES = new Map();

/*
 * Empty on purpose, and it started out non-empty.
 *
 * The first version waived `APP_ERROR` as "a fallback, never a contract value". The gate
 * then reported that waiver as stale, because `error-handler.ts` produces it as
 * `error.code || 'APP_ERROR'` rather than a literal in envelope position — so the scan
 * never sees it and the waiver matched nothing. That was the right complaint: a code that
 * can reach a client is a contract value whether or not anyone intended it to be, so it is
 * registered rather than excused. The stale-waiver check earned its place by firing on its
 * author.
 */

const IGNORED_DIR = /(^|\/)(node_modules|dist|build|coverage|\.next|\.turbo)(\/|$)/;

function listSourceFiles(root) {
  const out = [];
  const abs = join(REPO_ROOT, root);
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (IGNORED_DIR.test(full)) continue;
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(full)) continue;
      if (/\.(test|spec)\.tsx?$/.test(full)) continue;
      out.push(full);
    }
  };
  try {
    walk(abs);
  } catch {
    /* a root may be absent in a partial checkout */
  }
  return out;
}

/** How many lines either side of `code:` may carry the sibling `statusCode:`. */
const ENVELOPE_WINDOW = 4;

/**
 * Find every error code emitted in envelope position, with the statuses seen beside it.
 *
 * Exported for the unit test so the selection rule is asserted on fixtures rather than only
 * on the live tree, which changes under it.
 */
export function scanSource(text) {
  const lines = text.split('\n');
  const found = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const match = /(?:^|[\s{(])code:\s*'([A-Z][A-Z0-9_]{2,})'/.exec(lines[i]);
    if (!match) continue;
    const window = lines
      .slice(Math.max(0, i - ENVELOPE_WINDOW), i + ENVELOPE_WINDOW + 1)
      .join('\n');
    if (!/statusCode\s*:/.test(window)) continue;

    const code = match[1];
    if (!found.has(code)) found.set(code, new Set());
    // Every status in the window, not the first. Two emit sites on adjacent lines share a
    // window, so taking the first match attributed one site's status to the other — which
    // would have produced invented drift reports. Over-collecting is the safe direction:
    // `evaluate` passes when the declared status is among those observed, so a spurious
    // extra status cannot fail the gate, whereas a mis-attributed one could.
    for (const statusMatch of window.matchAll(/statusCode\s*:\s*(\d{3})/g)) {
      found.get(code).add(Number(statusMatch[1]));
    }
  }
  return found;
}

/** Read the registry's codes and declared statuses without importing TypeScript. */
export function parseRegistry(text) {
  const entries = new Map();
  const re = /code:\s*'([A-Z][A-Z0-9_]+)',\s*\n\s*httpStatus:\s*(\d{3})/g;
  let m;
  while ((m = re.exec(text)) !== null) entries.set(m[1], Number(m[2]));
  return entries;
}

export function evaluate({ emitted, registry, waived = WAIVED_CODES }) {
  const unregistered = [];
  const statusDrift = [];
  const staleWaivers = [];

  for (const [code, statuses] of emitted) {
    if (waived.has(code)) continue;
    if (!registry.has(code)) {
      unregistered.push({ code, statuses: [...statuses].sort((a, b) => a - b) });
      continue;
    }
    const declared = registry.get(code);
    const observed = [...statuses];
    // A code emitted only with statuses the registry does not list means the published
    // contract would mislead a client that switched on it.
    if (observed.length > 0 && !observed.includes(declared)) {
      statusDrift.push({ code, declared, observed: observed.sort((a, b) => a - b) });
    }
  }

  for (const code of waived.keys()) {
    if (!emitted.has(code)) staleWaivers.push(code);
  }

  return {
    ok: unregistered.length === 0 && statusDrift.length === 0 && staleWaivers.length === 0,
    unregistered,
    statusDrift,
    staleWaivers,
    emittedCount: emitted.size,
    registryCount: registry.size,
  };
}

function main() {
  const emitted = new Map();
  for (const root of SCAN_ROOTS) {
    for (const file of listSourceFiles(root)) {
      for (const [code, statuses] of scanSource(readFileSync(file, 'utf8'))) {
        if (!emitted.has(code)) emitted.set(code, new Set());
        for (const status of statuses) emitted.get(code).add(status);
      }
    }
  }

  const registry = parseRegistry(readFileSync(join(REPO_ROOT, REGISTRY_FILE), 'utf8'));
  const report = evaluate({ emitted, registry });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }

  console.log('Error-code registry gate (V15-19)');
  console.log(`  wire codes found : ${report.emittedCount}`);
  console.log(`  registry entries : ${report.registryCount}`);

  if (report.unregistered.length > 0) {
    console.error(`\n❌ ${report.unregistered.length} code(s) emitted but not in the registry:`);
    for (const row of report.unregistered) {
      console.error(`   • ${row.code} (status ${row.statuses.join(', ') || 'unknown'})`);
    }
    console.error(`\n   Add each to ${REGISTRY_FILE}, or waive it with a reason in WAIVED_CODES.`);
  }

  if (report.statusDrift.length > 0) {
    console.error(`\n❌ ${report.statusDrift.length} code(s) emitted with an undeclared status:`);
    for (const row of report.statusDrift) {
      console.error(
        `   • ${row.code}: registry says ${row.declared}, source emits ${row.observed.join(', ')}`,
      );
    }
  }

  if (report.staleWaivers.length > 0) {
    console.error(`\n❌ ${report.staleWaivers.length} waiver(s) no longer match any emit site:`);
    for (const code of report.staleWaivers) console.error(`   • ${code}`);
  }

  if (report.ok) {
    console.log('\n✅ every wire code is registered with a matching status');
    process.exit(0);
  }
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
