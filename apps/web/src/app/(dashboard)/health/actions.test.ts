/**
 * @vitest-environment node
 *
 * PRC-L410 — health write-action unit tests. Each action maps a successful
 * create to a success state (with the new row id) and maps a GatewayError to
 * its user-facing message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayError } from '@/lib/api/gateway';

const createCounsellingSession = vi.fn();
const createAllergy = vi.fn();
const createVaccination = vi.fn();
const createNurseIncident = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/health', () => ({
  createCounsellingSession: (...a: unknown[]) => createCounsellingSession(...a),
  createAllergy: (...a: unknown[]) => createAllergy(...a),
  createVaccination: (...a: unknown[]) => createVaccination(...a),
  createNurseIncident: (...a: unknown[]) => createNurseIncident(...a),
}));

import {
  createAllergyAction,
  createCounsellingSessionAction,
  createNurseIncidentAction,
  createVaccinationAction,
} from './actions';

const gwError = (message: string) => new GatewayError({ status: 403, code: 'FORBIDDEN', message });

describe('health write actions (PRC-L410)', () => {
  beforeEach(() => {
    for (const m of [
      createCounsellingSession,
      createAllergy,
      createVaccination,
      createNurseIncident,
    ])
      m.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it('createCounsellingSessionAction returns the session id on success', async () => {
    createCounsellingSession.mockResolvedValue({ id: 'cs-1' });
    const res = await createCounsellingSessionAction({ studentId: 's1' } as never);
    expect(res.status).toBe('success');
    expect(res.sessionId).toBe('cs-1');
  });

  it('createAllergyAction maps a GatewayError message', async () => {
    createAllergy.mockRejectedValue(gwError('PHI write denied'));
    const res = await createAllergyAction({ studentId: 's1' } as never);
    expect(res.status).toBe('error');
    expect(res.message).toBe('PHI write denied');
  });

  it('createVaccinationAction returns the row id on success', async () => {
    createVaccination.mockResolvedValue({ id: 'vac-1' });
    const res = await createVaccinationAction({ studentId: 's1' } as never);
    expect(res.status).toBe('success');
    expect(res.sessionId).toBe('vac-1');
  });

  it('createNurseIncidentAction maps a generic Error message', async () => {
    createNurseIncident.mockRejectedValue(new Error('network down'));
    const res = await createNurseIncidentAction({ studentId: 's1' } as never);
    expect(res.status).toBe('error');
    expect(res.message).toBe('network down');
  });

  it('createNurseIncidentAction returns the row id on success', async () => {
    createNurseIncident.mockResolvedValue({ id: 'inc-1' });
    const res = await createNurseIncidentAction({ studentId: 's1' } as never);
    expect(res.status).toBe('success');
    expect(res.sessionId).toBe('inc-1');
  });
});
