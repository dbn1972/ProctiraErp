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
          nationalId: 'NID-555-0101',
          dateOfBirth: 'x',
          customData: { admissionNumber: 'ADM-7' },
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
      { id: 's-101', label: 'ADM-7 · Zoya Khan', searchText: 'Zoya Khan ADM-7' },
    ]);
    expect(JSON.stringify(body)).not.toContain('dateOfBirth');
  });

  describe('HN-F4: national ID is never displayed or searchable', () => {
    const body = async (qs: string) =>
      ((await (await call(qs)).json()) as { data: Array<Record<string, string>> }).data;

    it('labels a student with the admission number, never the national ID', async () => {
      const data = await body('kind=student&q=zoya');
      expect(data).toHaveLength(1);
      expect(data[0]!.label).not.toContain('NID-555');
      expect(data[0]!.searchText).not.toContain('NID-555');
      expect(JSON.stringify(data)).not.toContain('NID-555');
    });

    it('labels a student without an admission number by name only', async () => {
      m.listStudents.mockResolvedValue({
        data: [{ id: 's-102', firstName: 'Ira', lastName: 'Das', nationalId: 'NID-555-0102' }],
      });
      expect(await body('kind=person&q=ira')).toEqual([
        { id: 's-102', label: 'Ira Das', searchText: 'Ira Das' },
      ]);
    });

    it('drops a row the gateway matched only by national ID', async () => {
      expect(await body('kind=student&q=NID-555')).toEqual([]);
      expect(await body('kind=student&q=0101')).toEqual([]);
    });

    it('keeps rows matched by first name, last name, full name or admission number', async () => {
      for (const q of ['ZOY', 'khan', 'zoya kh', 'adm-7']) {
        expect((await body(`kind=student&q=${encodeURIComponent(q)}`)).map((r) => r.id)).toEqual([
          's-101',
        ]);
      }
    });
  });
});
