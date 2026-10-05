/**
 * PRC-M488: every interpolated path segment in the gateway clients is
 * percent-encoded so server-action inputs cannot traverse to other routes.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const gatewayFetch = vi.fn();
vi.mock('./gateway', async () => {
  const actual = await vi.importActual<typeof import('./gateway')>('./gateway');
  return { ...actual, gatewayFetch: (...args: unknown[]) => gatewayFetch(...args) };
});
import { deleteTenantRole } from './admin.server';
import { deleteGradingScheme } from './assessments';
beforeEach(() => {
  gatewayFetch.mockReset();
  gatewayFetch.mockResolvedValue({ ok: true, status: 204, data: null });
});
describe('gateway path encoding (PRC-M488)', () => {
  it('deleteTenantRole encodes traversal characters in the id', async () => {
    await deleteTenantRole('a/../b');
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/tenant/roles/a%2F..%2Fb');
  });
  it('assessment helpers encode the id segment', async () => {
    await deleteGradingScheme('x/../../tenant/roles');
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/grading-schemes/x%2F..%2F..%2Ftenant%2Froles');
  });
  it('grep gate: no unencoded `/${...}` path interpolation in lib/api clients', () => {
    const dir = __dirname;
    // browser-gateway/gateway build the base URL itself (`/${path}`), not a segment.
    const skip = new Set(['browser-gateway.ts', 'gateway.ts']);
    const offenders: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') || file.includes('.test.') || skip.has(file)) continue;
      const lines = readFileSync(join(dir, file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/^\s*(\*|\/\/)/.test(line)) return;
        if (/\/\$\{(?!encodeURIComponent\()/.test(line)) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
