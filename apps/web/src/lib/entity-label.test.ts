/**
 * Entity label helpers — G-302 (no raw UUID as primary label).
 */
import { describe, expect, it } from 'vitest';

import {
  formatCodeNameLabel,
  formatPersonLabel,
  isUuidLike,
  resolveEntityLabel,
  toLabelMap,
} from './entity-label';

describe('entity-label', () => {
  it('formats code · name', () => {
    expect(formatCodeNameLabel('10-A', 'Class 10-A')).toBe('10-A · Class 10-A');
    expect(formatCodeNameLabel('', 'Only name')).toBe('Only name');
    expect(formatCodeNameLabel('R1', null)).toBe('R1');
  });

  it('formats person labels', () => {
    expect(formatPersonLabel('Ada', 'Lovelace', 'S-001')).toBe('S-001 · Ada Lovelace');
    expect(formatPersonLabel('Ada', 'Lovelace')).toBe('Ada Lovelace');
  });

  it('detects UUIDs and never uses full UUID as primary fallback', () => {
    const id = '33333333-3333-4333-8333-333333333333';
    expect(isUuidLike(id)).toBe(true);
    expect(resolveEntityLabel(id, new Map(), 'Student')).toBe('Student 33333333');
    expect(resolveEntityLabel(id, new Map([[id, 'S-01 · Ada Lovelace']]))).toBe(
      'S-01 · Ada Lovelace',
    );
  });

  it('builds label maps from options', () => {
    const map = toLabelMap([{ id: 'a', label: 'A · Alpha' }]);
    expect(map.get('a')).toBe('A · Alpha');
  });
});
