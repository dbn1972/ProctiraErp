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

  it('backend/gateway sources do not use fastify.prisma directly', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const root of ROOTS) {
      for (const file of sourceFiles(join(REPO, root))) {
        scanned += 1;
        const rel = relative(REPO, file);
        if (ALLOW.has(rel)) continue;
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (RAW_FASTIFY_PRISMA.test(line)) offenders.push(`${rel}:${i + 1}`);
          });
      }
    }
    expect(scanned).toBeGreaterThan(100);
    expect(offenders, `route DB access through withTenantTransaction: ${offenders.join(', ')}`).toEqual([]);
  });
});
