/**
 * Client components must not value-import server-only modules.
 *
 * A `'use client'` file that imports (non-`type`) from a module which reaches
 * `next/headers` / `server-only` breaks the whole Next dev build ("You're
 * importing a component that needs next/headers") and the production build.
 * Wave 9 shipped exactly this once (gradebook-workflow-panel → api/gradebook →
 * api/gateway), and the dev overlay then failed every page in the e2e run.
 *
 * The check is a cheap static walk over `@/…` imports within `src/`; it does
 * not resolve node_modules.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname);
const SERVER_ONLY = /from\s+['"](next\/headers|server-only)['"]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function isClientFile(source: string): boolean {
  return /^\s*['"]use client['"]/m.test(source.slice(0, 500));
}

/** Non-type import specifiers: `import x from`, `import { a, type B } from`, `export { x } from`. */
function valueImports(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(re)) {
    const clause = m[2] ?? '';
    if (/^type\s/.test(clause)) continue;
    // `import { type A, type B } from` is type-only too.
    const inner = clause.replace(/^\{|\}$/g, '').trim();
    if (
      clause.startsWith('{') &&
      inner
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .every((s) => s.startsWith('type '))
    ) {
      continue;
    }
    specs.push(m[3]!);
  }
  return specs;
}

function resolveLocal(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null;
  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    try {
      if (statSync(cand).isFile()) return cand;
    } catch {
      /* try next */
    }
  }
  return null;
}

const memo = new Map<string, string | null>();

/** Returns the import chain to a server-only import, or null. */
function serverOnlyChain(file: string, seen = new Set<string>()): string | null {
  if (memo.has(file)) return memo.get(file)!;
  if (seen.has(file)) return null;
  seen.add(file);
  const source = readFileSync(file, 'utf8');
  // Server actions are a legal client→server boundary: Next replaces the
  // module with action references, so whatever it imports never reaches the
  // client bundle.
  if (/^\s*['"]use server['"]/m.test(source.slice(0, 500))) {
    memo.set(file, null);
    return null;
  }
  if (SERVER_ONLY.test(source)) {
    memo.set(file, relative(SRC, file));
    return memo.get(file)!;
  }
  for (const spec of valueImports(source)) {
    const target = resolveLocal(file, spec);
    if (!target) continue;
    const chain = serverOnlyChain(target, seen);
    if (chain) {
      const full = `${relative(SRC, file)} → ${chain}`;
      memo.set(file, full);
      return full;
    }
  }
  memo.set(file, null);
  return null;
}

describe('client components never value-import server-only modules', () => {
  it("no 'use client' file reaches next/headers or server-only through value imports", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const source = readFileSync(file, 'utf8');
      if (!isClientFile(source)) continue;
      for (const spec of valueImports(source)) {
        const target = resolveLocal(file, spec);
        if (!target) continue;
        const chain = serverOnlyChain(target);
        if (chain) offenders.push(`${relative(SRC, file)} → ${chain}`);
      }
    }
    expect(offenders, `Server-only reach from client files:\n${offenders.join('\n')}`).toEqual([]);
  });
});
