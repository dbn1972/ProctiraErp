/**
 * PRC-M367 CI guard: services must not query through the decorated
 * `fastify.prisma` (no tenant GUC outside a transaction). Tenant-scoped DB
 * access goes through withTenantTransaction / withTenantClient.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO = resolve(__dirname, '../../../../..');
const ROOTS = ['packages/backend', 'apps/api-gateway/src', 'apps/etl-worker/src'];
/** Decorated-instance Prisma access, e.g. fastify.prisma.x / request.server.prisma. */
export const RAW_FASTIFY_PRISMA = /\b(?:fastify|app|server|instance)\.prisma\s*(?:\.|\?\.|\[)/;
const INSTANCE = '(?:fastify|app|server|instance)';
const MEMBER_PATH = String.raw`(?:[\w$]+\??\.)*`;
/**
 * #555 review #11: aliasing the decorated client escapes the direct-access
 * pattern, so these forms are forbidden too (multi-line aware):
 * - `const db = fastify.prisma` / `db = request.server.prisma` (assignment alias)
 * - `const { prisma } = fastify` / `const { prisma: db } = request.server`
 * - `fastify['prisma']` / `app?.["prisma"]` (computed access)
 * Passing `fastify.prisma` straight into withTenantTransaction(...) stays allowed.
 */
export const PRISMA_ALIAS_PATTERNS: readonly RegExp[] = [
  // assignment alias: `= <path>.fastify.prisma` not followed by member access
  new RegExp(
    String.raw`=\s*` + MEMBER_PATH + INSTANCE + String.raw`\??\.prisma\b(?!\s*(?:\.|\?\.|\[|\())`,
    'g',
  ),
  // destructuring alias: `{ ..prisma.. } = <path>.fastify`
  new RegExp(
    String.raw`\{[^{}]*\bprisma\b[^{}]*\}\s*=\s*` + MEMBER_PATH + INSTANCE + String.raw`\b`,
    'g',
  ),
  // computed access: `fastify['prisma']`, `app?.["prisma"]`
  new RegExp(String.raw`\b` + INSTANCE + String.raw`\??\.?\[\s*['"\x60]prisma['"\x60]\s*\]`, 'g'),
];
/** Line numbers (1-based) of every forbidden form in `source`. */
export function findRawPrismaAccess(source: string): number[] {
  const lines = new Set<number>();
  source.split('\n').forEach((line, i) => {
    if (RAW_FASTIFY_PRISMA.test(line)) lines.add(i + 1);
  });
  for (const pattern of PRISMA_ALIAS_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      lines.add(source.slice(0, match.index).split('\n').length);
    }
  }
  return [...lines].sort((a, b) => a - b);
}
const ALLOW = new Set<string>([]);

function* sourceFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* sourceFiles(full);
    else if (/\.ts$/.test(name) && !/\.(test|spec)\.ts$|\.d\.ts$/.test(name)) yield full;
  }
}

describe('PRC-M367: no queries via decorated fastify.prisma', () => {
  it('pattern catches the forbidden forms', () => {
    expect(RAW_FASTIFY_PRISMA.test('await fastify.prisma.student.findMany()')).toBe(true);
    expect(RAW_FASTIFY_PRISMA.test('request.server.prisma.$queryRaw`x`')).toBe(true);
    expect(RAW_FASTIFY_PRISMA.test("app.prisma?.['fee']")).toBe(true);
    expect(RAW_FASTIFY_PRISMA.test('withTenantTransaction(prisma, tenantId, fn)')).toBe(false);
  });
  it('#555 review #11: aliasing the decorated client is caught', () => {
    const forbidden = [
      'const db = fastify.prisma;',
      'let client = request.server.prisma',
      'this.db = app.prisma;',
      'const { prisma } = fastify;',
      'const { prisma: db, log } = request.server;',
      'const {\n  log,\n  prisma,\n} = instance;',
      "const db = fastify['prisma'];",
      'const db = app?.["prisma"];',
    ];
    for (const src of forbidden) expect(findRawPrismaAccess(src), src).not.toEqual([]);
    const allowed = [
      'await withTenantTransaction(fastify.prisma, tenantId, fn)',
      'const prisma = createPrismaClient(url);',
      'const { prisma } = options;',
      'fastify.decorate("prisma", client)',
      'const x = fastify.prismaReady;',
    ];
    for (const src of allowed) expect(findRawPrismaAccess(src), src).toEqual([]);
    expect(findRawPrismaAccess('a\nconst { prisma } = fastify;\n')).toEqual([2]);
  });

  it('backend/gateway sources do not use fastify.prisma directly', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const root of ROOTS) {
      for (const file of sourceFiles(join(REPO, root))) {
        scanned += 1;
        const rel = relative(REPO, file);
        if (ALLOW.has(rel)) continue;
        for (const line of findRawPrismaAccess(readFileSync(file, 'utf8'))) {
          offenders.push(`${rel}:${line}`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(100);
    expect(
      offenders,
      `route DB access through withTenantTransaction: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
