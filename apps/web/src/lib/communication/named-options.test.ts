import { describe, expect, it } from 'vitest';

import { toNamedOptions } from './named-options';

describe('toNamedOptions', () => {
  it('labels a school by code and name', () => {
    expect(
      toNamedOptions([
        {
          id: '00000000-0000-4000-8000-00000000a551',
          code: 'SPS-PUN-01',
          name: 'Sunrise Public School',
        },
      ]),
    ).toEqual([
      {
        id: '00000000-0000-4000-8000-00000000a551',
        label: 'SPS-PUN-01 · Sunrise Public School',
        searchText: 'SPS-PUN-01 Sunrise Public School',
      },
    ]);
  });

  it('skips blank ids and still names a row that has only a name', () => {
    expect(
      toNamedOptions([
        { id: '  ', name: 'Drop' },
        { id: 'c1', name: '9-B' },
      ]),
    ).toEqual([{ id: 'c1', label: '9-B', searchText: '9-B' }]);
  });
});
