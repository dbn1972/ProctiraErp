/**
 * PRC-M489: dedicated mocked-gateway suite for the health client.
 *
 * `getHealthRecordResult` 404-vs-403 is also covered in
 * `domain-clients-2.test.ts`. The role checks below pin the current
 * whole-value matching only; they do not change any role list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetch = vi.fn();
vi.mock('./gateway', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('./gateway');
  return { ...actual, gatewayFetch: (...args: unknown[]) => gatewayFetch(...args) };
});

import { GatewayError } from './gateway';
import {
  canAccessHealthRecords,
  canAccessPhiAccessLogs,
  createCounsellingSession,
  getHealthRecordResult,
  listHealthRecordsResult,
  listScreeningPrograms,
  listStudentVaccinationsResult,
  type CreateCounsellingSessionInput,
} from './health';

function ok<T>(data: T) {
  return { ok: true, status: 200, data };
}
function fail(status: number) {
  return { ok: false, status, data: null, error: { code: 'E', message: 'e' } };
}
const roles = (...names: string[]) => names.map((roleName) => ({ roleName }));

beforeEach(() => {
  gatewayFetch.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('health role checks (PRC-M489)', () => {
  it('grants health records to listed roles, case-insensitively', () => {
    expect(canAccessHealthRecords(roles('NURSE'))).toBe(true);
    expect(canAccessHealthRecords(roles('teacher', 'counsellor'))).toBe(true);
  });

  it('denies health records to near-miss role names (whole-value match)', () => {
    expect(canAccessHealthRecords(roles('library_administrator'))).toBe(false);
    expect(canAccessHealthRecords(roles('former_health_officer'))).toBe(false);
    expect(canAccessHealthRecords([])).toBe(false);
  });

  it('keeps the PHI access log a stricter gate than health records', () => {
    expect(canAccessPhiAccessLogs(roles('health_admin'))).toBe(true);
    expect(canAccessPhiAccessLogs(roles('SUPER_ADMIN'))).toBe(true);
    expect(canAccessPhiAccessLogs(roles('nurse'))).toBe(false);
    expect(canAccessPhiAccessLogs(roles('counsellor'))).toBe(false);
  });

  it('denies the PHI access log to substring look-alikes', () => {
    for (const name of [
      'Administrator',
      'library_administrator',
      'former_health_officer',
      'trainee_health_officer',
    ]) {
      expect(canAccessPhiAccessLogs(roles(name))).toBe(false);
    }
  });
});

describe('health list reads keep the failure reason (PRC-M489)', () => {
  it('reads health records and preserves a denial', async () => {
    gatewayFetch.mockResolvedValueOnce(ok({ data: [{ id: 'h-1' }] }));
    await expect(listHealthRecordsResult()).resolves.toMatchObject({
      ok: true,
      items: [{ id: 'h-1' }],
    });
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/health/records');
    expect(gatewayFetch.mock.calls[0]![1]).toMatchObject({ throwOnError: false });

    gatewayFetch.mockResolvedValueOnce(fail(403));
    await expect(listHealthRecordsResult()).resolves.toMatchObject({
      ok: false,
      kind: 'denied',
      status: 403,
    });
  });

  it('encodes the student id for vaccinations and keeps an outage distinct from empty', async () => {
    gatewayFetch.mockResolvedValueOnce(fail(503));
    await expect(listStudentVaccinationsResult('s/1')).resolves.toMatchObject({
      ok: false,
      kind: 'unavailable',
      status: 503,
    });
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/health/vaccinations/student/s%2F1');
  });

  it('classifies a single-record 401 as unauthenticated and encodes the id', async () => {
    gatewayFetch.mockResolvedValueOnce(fail(401));
    await expect(getHealthRecordResult('s/1')).resolves.toEqual({
      ok: false,
      kind: 'unauthenticated',
      status: 401,
    });
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/health/records/s%2F1');
  });

  it('treats an ok response with no body as a 404 (none on file)', async () => {
    gatewayFetch.mockResolvedValueOnce(ok(null));
    await expect(getHealthRecordResult('s1')).resolves.toEqual({
      ok: false,
      kind: 'missing',
      status: 404,
    });
  });
});

describe('health writes and screenings (PRC-M489)', () => {
  const input: CreateCounsellingSessionInput = {
    studentId: 's-1',
    counsellorId: 'c-1',
    sessionDate: '2025-03-01',
    sessionType: 'individual',
    reason: 'check-in',
    caseNotes: 'notes',
    followUpRequired: false,
    status: 'scheduled',
  };

  it('creates a counselling session with POST', async () => {
    gatewayFetch.mockResolvedValueOnce(ok({ id: 'cs-1' }));
    await expect(createCounsellingSession(input)).resolves.toEqual({ id: 'cs-1' });
    expect(gatewayFetch).toHaveBeenCalledWith('/health/counselling/sessions', {
      method: 'POST',
      json: input,
    });
  });

  it('throws a GatewayError carrying the upstream code on an empty create', async () => {
    gatewayFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'bad' },
    });
    const error = await createCounsellingSession(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ status: 422, code: 'VALIDATION_ERROR' });
  });

  it('lists screening programs and returns [] on failure', async () => {
    gatewayFetch.mockResolvedValueOnce(ok({ data: [{ id: 'sp-1' }] }));
    await expect(listScreeningPrograms()).resolves.toEqual([{ id: 'sp-1' }]);
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/health/screenings');

    gatewayFetch.mockResolvedValueOnce(fail(500));
    await expect(listScreeningPrograms()).resolves.toEqual([]);
  });
});
