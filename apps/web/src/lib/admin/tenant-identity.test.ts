import { describe, expect, it } from 'vitest';

import { isUnsavedSettingsTimestamp, tenantIdentityCopy } from './tenant-identity';

describe('tenant identity copy', () => {
  it('treats the epoch default as unsaved', () => {
    expect(isUnsavedSettingsTimestamp('1970-01-01T00:00:00.000Z')).toBe(true);
    expect(isUnsavedSettingsTimestamp(undefined)).toBe(true);
    expect(isUnsavedSettingsTimestamp('2026-09-27T00:00:00.000Z')).toBe(false);
  });

  it('shows the school name and slug instead of a raw id', () => {
    expect(
      tenantIdentityCopy({
        directoryName: 'Sunrise Public School',
        slug: 'sunrise-public-school',
        updatedAt: '1970-01-01T00:00:00.000Z',
      }),
    ).toEqual({
      schoolLine: 'Sunrise Public School · sunrise-public-school',
      savedLine: null,
    });
  });
});
