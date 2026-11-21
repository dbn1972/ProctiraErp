/**
 * T-D3-R3 (#732 review): `deleteRouteStop` turns a failed DELETE into a GatewayError that keeps
 * the gateway correlation id, so the transport action can show it as the support reference.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const gatewayFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/gateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/gateway')>()),
  gatewayFetch: (...args: unknown[]) => gatewayFetch(...args),
}));
import { GatewayError } from '@/lib/api/gateway';
import { deleteRouteStop } from './api';
const STOP = '00000000-0000-4000-8000-00000000c0de';
beforeEach(() => {
  gatewayFetch.mockReset();
});
describe('deleteRouteStop (T-D3-R3)', () => {
  it('forwards the gateway correlation id on a failed delete', async () => {
    gatewayFetch.mockResolvedValue({
      status: 409,
      ok: false,
      data: null,
      error: { code: 'CONFLICT', message: 'Stop has assignments' },
      correlationId: 'corr-1234abcd',
    });
    const error = await deleteRouteStop(STOP).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ status: 409, code: 'CONFLICT', correlationId: 'corr-1234abcd' });
    expect(gatewayFetch).toHaveBeenCalledWith(`/transport/stops/${STOP}`, {
      method: 'DELETE',
      throwOnError: false,
    });
  });
  it('omits the correlation id when the gateway sent none', async () => {
    gatewayFetch.mockResolvedValue({ status: 500, ok: false, data: null });
    const error = (await deleteRouteStop(STOP).catch((e: unknown) => e)) as GatewayError;
    expect(error).toMatchObject({ status: 500, code: 'DELETE_FAILED' });
    expect(error.correlationId).toBeUndefined();
  });
  it('resolves on 204', async () => {
    gatewayFetch.mockResolvedValue({ status: 204, ok: true, data: null });
    await expect(deleteRouteStop(STOP)).resolves.toBeUndefined();
  });
});
