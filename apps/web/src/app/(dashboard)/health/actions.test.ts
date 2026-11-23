/**
 * @vitest-environment node
 *
 * PRC-L410 — health write-action unit tests. Each action maps a successful
 * create to a success state (with the new row id).
 * RAW-WEB (health): failures show fixed copy plus a reference (genericActionErrorMessage),
 * never the gateway or server text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayError } from '@/lib/api/gateway';
import { CONFLICT_ACTION_MESSAGE, PERMISSION_DENIED_ACTION_MESSAGE } from '@/lib/api/action-error';

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
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Fixed copy followed by a plain reference token. */
const REF = (text: string) => new RegExp(`^${escape(text)} \\(ref [A-Za-z0-9-]{8,64}\\)$`);

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
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('createCounsellingSessionAction returns the session id on success', async () => {
    createCounsellingSession.mockResolvedValue({ id: 'cs-1' });
    const res = await createCounsellingSessionAction({ studentId: 's1' } as never);
    expect(res.status).toBe('success');
    expect(res.sessionId).toBe('cs-1');
  });

  it('createAllergyAction shows fixed permission copy for a 403, not the gateway text', async () => {
    createAllergy.mockRejectedValue(gwError('PHI write denied for resource health:allergy'));
    const res = await createAllergyAction({ studentId: 's1' } as never);
    expect(res.status).toBe('error');
    expect(res.message).toMatch(REF(PERMISSION_DENIED_ACTION_MESSAGE));
    expect(res.message).not.toContain('PHI write denied');
  });

  it.each([
    [
      'createCounsellingSessionAction',
      createCounsellingSessionAction,
      createCounsellingSession,
      'Failed to create counselling session',
    ],
    ['createAllergyAction', createAllergyAction, createAllergy, 'Failed to create allergy'],
    [
      'createVaccinationAction',
      createVaccinationAction,
      createVaccination,
      'Failed to create vaccination',
    ],
    [
      'createNurseIncidentAction',
      createNurseIncidentAction,
      createNurseIncident,
      'Failed to create incident',
    ],
  ] as const)('%s never shows raw server text', async (_name, run, create, fallback) => {
    create.mockRejectedValue(
      new GatewayError({
        status: 500,
        code: 'INTERNAL',
        message: 'duplicate key value violates unique constraint "health_vaccinations_pkey"',
      }),
    );
    const res = await run({ studentId: 's1' } as never);
    expect(res.status).toBe('error');
    expect(res.message).toMatch(REF(fallback));
    expect(res.message).not.toContain('constraint');
    create.mockRejectedValue(
      new GatewayError({ status: 409, code: 'CONFLICT', message: 'raw 409' }),
    );
    expect((await run({ studentId: 's1' } as never)).message).toMatch(REF(CONFLICT_ACTION_MESSAGE));
  });

  it('createVaccinationAction returns the row id on success', async () => {
    createVaccination.mockResolvedValue({ id: 'vac-1' });
    const res = await createVaccinationAction({ studentId: 's1' } as never);
    expect(res.status).toBe('success');
    expect(res.sessionId).toBe('vac-1');
  });

  it('createNurseIncidentAction hides a generic Error message behind the fallback', async () => {
    createNurseIncident.mockRejectedValue(new Error('fetch failed http://internal:3000'));
    const res = await createNurseIncidentAction({ studentId: 's1' } as never);
    expect(res.status).toBe('error');
    expect(res.message).toMatch(REF('Failed to create incident'));
    expect(res.message).not.toContain('internal');
  });

  it('createNurseIncidentAction returns the row id on success', async () => {
    createNurseIncident.mockResolvedValue({ id: 'inc-1' });
    const res = await createNurseIncidentAction({ studentId: 's1' } as never);
    expect(res.status).toBe('success');
    expect(res.sessionId).toBe('inc-1');
  });
});
