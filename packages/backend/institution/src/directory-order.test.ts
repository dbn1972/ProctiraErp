import { describe, expect, it } from 'vitest';

import { compareDirectoryInstitutions } from './directory-order';

describe('compareDirectoryInstitutions', () => {
  it('lists active schools by code, then inactive schools', () => {
    const rows = [
      { name: 'Junior', status: 'active', code: '07040100618' },
      { name: 'Vasundhara', status: 'inactive', code: '07040100844' },
      { name: 'Rohini', status: 'ACTIVE', code: '07040200731' },
      { name: 'Mayur', status: 'active', code: '07040100417' },
      { name: 'Preet', status: 'active', code: '07040100522' },
    ];
    rows.sort(compareDirectoryInstitutions);
    expect(rows.map((row) => row.name)).toEqual([
      'Mayur',
      'Preet',
      'Junior',
      'Rohini',
      'Vasundhara',
    ]);
  });
});
