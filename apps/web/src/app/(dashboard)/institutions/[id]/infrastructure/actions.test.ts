/**
 * @vitest-environment node
 *
 * PRC-L411 — infrastructure write-action unit tests. Each action rejects a
 * malformed (non-uuid) id before any gateway call, maps a gateway `!ok`
 * envelope to its error message, and scopes the facility update to the route
 * institution (PRC-H022).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetch = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/gateway', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/gateway')>('@/lib/api/gateway');
  return { ...actual, gatewayFetch: (...a: unknown[]) => gatewayFetch(...a) };
});

import { createRoomAction, logRepairRequestAction, updateFacilityAction } from './actions';

const INST = '55555555-5555-4555-8555-555555555555';
const FLOOR = '66666666-6666-4666-8666-666666666666';
const FAC = '77777777-7777-4777-8777-777777777777';

describe('infrastructure actions (PRC-L411)', () => {
  beforeEach(() => gatewayFetch.mockReset());
  afterEach(() => vi.clearAllMocks());

  it('logRepairRequestAction rejects a non-uuid id before the gateway', async () => {
    const res = await logRepairRequestAction({
      institutionId: 'nope',
      infrastructureId: FAC,
      summary: 'Broken window',
    });
    expect(res.ok).toBe(false);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('logRepairRequestAction maps a gateway failure envelope to its message', async () => {
    gatewayFetch.mockResolvedValue({ ok: false, error: { message: 'queue full' } });
    const res = await logRepairRequestAction({
      institutionId: INST,
      infrastructureId: FAC,
      summary: 'Broken window',
    });
    expect(res).toEqual({ ok: false, error: 'queue full' });
  });

  it('logRepairRequestAction returns the new id on success', async () => {
    gatewayFetch.mockResolvedValue({ ok: true, data: { id: 'rr-1' } });
    const res = await logRepairRequestAction({
      institutionId: INST,
      infrastructureId: FAC,
      summary: 'Broken window',
    });
    expect(res).toEqual({ ok: true, id: 'rr-1' });
  });

  it('createRoomAction rejects an empty name before the gateway', async () => {
    const res = await createRoomAction({
      institutionId: INST,
      floorId: FLOOR,
      name: '',
      capacity: 30,
      condition: 'Good',
    });
    expect(res.ok).toBe(false);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('updateFacilityAction scopes the PUT to the route institution (PRC-H022)', async () => {
    gatewayFetch.mockResolvedValue({ ok: true });
    const res = await updateFacilityAction({
      institutionId: INST,
      id: FAC,
      name: 'Lab A',
      capacity: 40,
      condition: 'Fair',
    });
    expect(res.ok).toBe(true);
    const url = gatewayFetch.mock.calls[0]![0] as string;
    expect(url).toContain(`/infrastructure/${FAC}`);
    expect(url).toContain(`institutionId=${INST}`);
  });

  it('updateFacilityAction forwards only the provided fields (PRC-L255)', async () => {
    gatewayFetch.mockResolvedValue({ ok: true });
    const res = await updateFacilityAction({ institutionId: INST, id: FAC, capacity: 45 });
    expect(res.ok).toBe(true);
    const init = gatewayFetch.mock.calls[0]![1] as { method: string; json: unknown };
    expect(init.method).toBe('PUT');
    expect(init.json).toEqual({ capacity: 45 });
  });

  it('updateFacilityAction makes no gateway call when nothing changed (PRC-L255)', async () => {
    const res = await updateFacilityAction({ institutionId: INST, id: FAC });
    expect(res).toEqual({ ok: true });
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('updateFacilityAction rejects a non-uuid facility id', async () => {
    const res = await updateFacilityAction({
      institutionId: INST,
      id: 'not-a-uuid',
      name: 'Lab A',
      capacity: 40,
      condition: 'Good',
    });
    expect(res.ok).toBe(false);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });
});
