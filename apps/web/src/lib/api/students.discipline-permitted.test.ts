/**
 * PRC-M121: the profile's discipline read tells "not permitted" (403) apart from "no incidents",
 * so the discipline card is hidden from roles the gateway refuses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => ({ value: 'tok' }) }),
  headers: () => ({ get: () => null }),
}));
vi.mock('@/lib/auth', () => ({
  AUTH_COOKIES: { ACCESS_TOKEN: 'access_token' },
  decodeTokenPayload: () => ({ tenantId: 'tenant-1' }),
}));
vi.mock('@/lib/auth/verified-token', () => ({
  readSessionToken: async () => ({ tenantId: 'tenant-1' }),
  tenantIdFromClaims: (claims: { tenantId?: string } | null) => claims?.tenantId ?? null,
}));
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
import * as students from './students';
function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
beforeEach(() => {
  fetchMock.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});
describe('listStudentDisciplineIfPermitted (PRC-M121)', () => {
  it('returns null when the gateway refuses discipline records (403)', async () => {
    expect(typeof students.listStudentDisciplineIfPermitted).toBe('function');
    fetchMock.mockResolvedValue(
      jsonResponse(403, { code: 'FORBIDDEN', message: 'Forbidden', statusCode: 403 }),
    );
    await expect(students.listStudentDisciplineIfPermitted('stu-1')).resolves.toBeNull();
  });
  it('returns the incidents (or an empty list) when permitted', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [{ id: 'i1' }], total: 1 }));
    await expect(students.listStudentDisciplineIfPermitted('stu-1')).resolves.toEqual([
      { id: 'i1' },
    ]);
    fetchMock.mockResolvedValue(jsonResponse(200, { data: [], total: 0 }));
    await expect(students.listStudentDisciplineIfPermitted('stu-1')).resolves.toEqual([]);
  });
});
