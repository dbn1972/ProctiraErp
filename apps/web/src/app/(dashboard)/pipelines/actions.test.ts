/**
 * PRC-M109 — pipelines are created from user-supplied source config and a
 * connection id only; no credentials or demo literals leave the web tier.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayFetch } = vi.hoisted(() => ({ gatewayFetch: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/gateway', () => ({
  gatewayFetch,
  GatewayError: class GatewayError extends Error {},
}));

import { createPipelineAction } from './actions';

const base = {
  name: 'Roster',
  sourceType: 'csv' as const,
  csvContent: 'id,name\n1,A',
  connectionId: 'warehouse',
  table: 'roster',
  mappings: 'id -> student_id\nname -> full_name',
  enabled: false,
};

describe('createPipelineAction (PRC-M109)', () => {
  beforeEach(() => {
    gatewayFetch.mockReset().mockResolvedValue({ ok: true, status: 201, data: { id: 'p1' } });
  });

  it('sends the user source, a connection reference and enabled:false', async () => {
    expect((await createPipelineAction(base)).status).toBe('success');
    const sent = gatewayFetch.mock.calls[0]![1].json;
    expect(sent.source).toEqual({ type: 'csv', fileContent: 'id,name\n1,A', hasHeader: true });
    expect(sent.destination).toEqual({
      type: 'connection',
      connectionId: 'warehouse',
      table: 'roster',
    });
    expect(sent.fieldMappings).toEqual([
      { sourceField: 'id', destinationField: 'student_id' },
      { sourceField: 'name', destinationField: 'full_name' },
    ]);
    expect(sent.enabled).toBe(false);
    expect(JSON.stringify(sent)).not.toMatch(/password|username|host/);
  });

  it('requires an https REST URL and a connection', async () => {
    expect(
      (await createPipelineAction({ ...base, sourceType: 'rest_api', restUrl: 'http://x.test' }))
        .status,
    ).toBe('error');
    expect((await createPipelineAction({ ...base, connectionId: '' })).status).toBe('error');
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('rejects malformed mappings', async () => {
    const res = await createPipelineAction({ ...base, mappings: 'id -> bad column!' });
    expect(res).toMatchObject({ status: 'error' });
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('etl client has no demo host/credential literals', () => {
    const src = readFileSync(path.resolve(__dirname, '../../../lib/api/etl.ts'), 'utf8');
    expect(src).not.toMatch(/localhost|'etl'|example\.invalid|1,demo/);
  });
});
