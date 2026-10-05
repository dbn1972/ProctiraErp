/**
 * PRC-M083: directory search route — authenticated, bounded, labels only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ getSession: vi.fn(), listStudents: vi.fn(), listStaff: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ getSession: m.getSession }));
vi.mock('@/lib/api/students', () => ({ listStudents: m.listStudents }));
vi.mock('@/lib/api/staff', () => ({ listStaff: m.listStaff }));

import { GET } from './route';

const call = (qs: string) => GET(new Request(`http://web/api/directory/search?${qs}`));

describe('GET /api/directory/search (PRC-M083)', () => {
  beforeEach(() => {
    m.getSession.mockResolvedValue({ user: { sub: 'u', tenantId: 't' } });
    m.listStudents.mockResolvedValue({
      data: [
        {
          id: 's-101',
          firstName: 'Zoya',
          lastName: 'Khan',
          nationalId: 'ADM-101',
          dateOfBirth: 'x',
        },
      ],
    });
    m.listStaff.mockResolvedValue({ data: [] });
  });

  it('rejects unauthenticated callers', async () => {
    m.getSession.mockResolvedValue(null);
    expect((await call('kind=student&q=zo')).status).toBe(401);
  });

  it('rejects bad kind or too-short query', async () => {
    expect((await call('kind=guardian&q=zoya')).status).toBe(400);
    expect((await call('kind=student&q=z')).status).toBe(400);
  });

  it('returns labels only, searched server-side', async () => {
    const res = await call('kind=student&q=zoya');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, string>> };
    expect(m.listStudents).toHaveBeenCalledWith({ search: 'zoya', pageSize: 20 });
    expect(body.data).toEqual([
      { id: 's-101', label: 'ADM-101 · Zoya Khan', searchText: 'Zoya Khan ADM-101' },
    ]);
    expect(JSON.stringify(body)).not.toContain('dateOfBirth');
  });
});
