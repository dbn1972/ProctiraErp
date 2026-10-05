import { beforeEach, describe, expect, it, vi } from 'vitest';

const listInstitutionsPage = vi.fn();
const listClassesByInstitution = vi.fn();
vi.mock('@/lib/api/institutions', () => ({
  listInstitutionsPage: (p: unknown) => listInstitutionsPage(p),
}));
vi.mock('@/lib/institutions/api', () => ({
  listClassesByInstitution: (id: string) => listClassesByInstitution(id),
}));

import { loadFeeClassLabels } from './load-fee-class-labels';

describe('PRC-M477 fee class labels', () => {
  beforeEach(() => {
    const institutions = Array.from({ length: 250 }, (_, i) => ({ id: `inst-${i}` }));
    listInstitutionsPage.mockReset().mockImplementation(async ({ page }: { page: number }) => ({
      data: institutions.slice((page - 1) * 100, page * 100),
      totalItems: 250,
    }));
    listClassesByInstitution
      .mockReset()
      .mockImplementation(async (id: string) => [{ id: `class-${id}`, name: `Class of ${id}` }]);
  });

  it('resolves classes belonging to institutions beyond the first 100', async () => {
    const labels = await loadFeeClassLabels(['class-inst-240']);
    expect(labels['class-inst-240']).toBe('Class of inst-240');
    expect(listInstitutionsPage).toHaveBeenCalledTimes(3);
  });

  it('stops early once every requested class is labelled', async () => {
    const labels = await loadFeeClassLabels(['class-inst-5']);
    expect(labels).toEqual({ 'class-inst-5': 'Class of inst-5' });
    expect(listInstitutionsPage).toHaveBeenCalledTimes(1);
  });

  it('does no lookups when the report has no classes', async () => {
    expect(await loadFeeClassLabels([])).toEqual({});
    expect(listInstitutionsPage).not.toHaveBeenCalled();
  });
});
