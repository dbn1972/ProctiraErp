import { beforeEach, describe, expect, it, vi } from 'vitest';

const listAreaTree = vi.fn();
vi.mock('./api', () => ({ listAreaTree: () => listAreaTree() }));

import { loadAreaOptions, loadInstitutionFormLookups } from './lookups';

describe('PRC-M155 institution lookups never invent areas', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('areas API failure -> no fake areas, error reported for the form', async () => {
    listAreaTree.mockRejectedValue(new Error('500'));
    const lookups = await loadInstitutionFormLookups();
    expect(lookups.areas).toEqual([]);
    expect(lookups.lookupErrors).toEqual(['areas']);
    expect(await loadAreaOptions()).toEqual([]);
  });

  it('empty area tree is empty, not placeholder ids', async () => {
    listAreaTree.mockResolvedValue([]);
    const lookups = await loadInstitutionFormLookups();
    expect(lookups.areas).toEqual([]);
    expect(lookups.lookupErrors).toEqual([]);
    expect(JSON.stringify(lookups.areas)).not.toContain('00000000-');
  });

  it('flattens the real area tree', async () => {
    listAreaTree.mockResolvedValue([
      { id: 'a1', name: 'State', children: [{ id: 'a2', name: 'District', children: [] }] },
    ]);
    const lookups = await loadInstitutionFormLookups();
    expect(lookups.areas.map((a) => a.id)).toEqual(['a1', 'a2']);
  });
});
