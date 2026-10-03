/** PRC-M084: DSAR export is an explicit server action using the audited POST. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ exportDsarPackage: vi.fn() }));
vi.mock('@/lib/api/platform.server', () => ({ exportDsarPackage: m.exportDsarPackage }));
vi.mock('@/lib/load-entity-labels', () => ({
  loadStudentOptions: vi.fn(async () => [{ id: 'stu-1', label: 'Asha Rao' }]),
  loadStaffOptions: vi.fn(async () => []),
  withPersonLabels: vi.fn(async (base: Map<string, string>) => base),
}));

import { buildDsarPackageAction } from './actions';

const pack = {
  subjectId: 'stu-1',
  tenantId: 't',
  exportedAt: '2024-01-01T00:00:00Z',
  entryCount: 1,
  truncated: false,
  entries: [
    {
      id: 'e1',
      entityType: 'student',
      entityId: 'stu-1',
      operation: 'CREATE',
      userId: 'u-1',
      userName: 'Admin',
      ipAddress: null,
      timestamp: '2024-01-01T00:00:00Z',
      changedFields: ['name'],
    },
  ],
};

describe('buildDsarPackageAction (PRC-M084)', () => {
  beforeEach(() => m.exportDsarPackage.mockReset());

  it('rejects invalid subject ids without exporting', async () => {
    const res = await buildDsarPackageAction('bad id/../x');
    expect(res.status).toBe('invalid');
    expect(m.exportDsarPackage).not.toHaveBeenCalled();
  });

  it('exports and returns only labels for ids in the package', async () => {
    m.exportDsarPackage.mockResolvedValue({
      data: pack,
      raw: { ...pack, entries: [{ id: 'e1', afterValues: { name: 'A' } }] },
      source: 'gateway',
      access: 'ok',
    });
    const res = await buildDsarPackageAction(' stu-1 ');
    expect(m.exportDsarPackage).toHaveBeenCalledWith('stu-1');
    expect(res.status).toBe('ok');
    expect(res.labels).toEqual({ 'stu-1': 'Asha Rao' });
    expect(res.downloadJson).toContain('afterValues');
  });

  it('maps forbidden access', async () => {
    m.exportDsarPackage.mockResolvedValue({ data: null, source: 'gateway', access: 'forbidden' });
    expect((await buildDsarPackageAction('stu-1')).status).toBe('forbidden');
  });
});
