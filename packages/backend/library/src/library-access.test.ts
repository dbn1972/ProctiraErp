/**
 * W1-SEC-02 — library domain RBAC unit tests.
 */
import { describe, expect, it } from 'vitest';

import {
  assertLibraryAccess,
  hasLibraryAccess,
  libraryActionForMethod,
  normalizeLibraryRoles,
} from './library-access.js';

describe('library-access (W1-SEC-02)', () => {
  it('normalizes string and object roles', () => {
    expect(normalizeLibraryRoles(['Admin', { roleName: 'Librarian' }])).toEqual([
      'admin',
      'librarian',
    ]);
  });

  it('allows library staff to write', () => {
    expect(hasLibraryAccess(['librarian'], 'library.write')).toBe(true);
    expect(hasLibraryAccess(['admin'], 'library.read')).toBe(true);
    expect(hasLibraryAccess(['registrar'], 'library.write')).toBe(true);
  });

  it('allows portal roles only for library.portal', () => {
    expect(hasLibraryAccess(['parent'], 'library.portal')).toBe(true);
    expect(hasLibraryAccess(['student'], 'library.portal')).toBe(true);
    expect(hasLibraryAccess(['parent'], 'library.write')).toBe(false);
    expect(hasLibraryAccess(['parent'], 'library.read')).toBe(false);
  });

  it('denies teachers/viewers/empty roles (fail closed)', () => {
    expect(hasLibraryAccess(['teacher'], 'library.read')).toBe(false);
    expect(hasLibraryAccess(['viewer'], 'library.write')).toBe(false);
    expect(hasLibraryAccess([], 'library.write')).toBe(false);
    expect(() => assertLibraryAccess(['viewer'], 'library.write')).toThrow(/Forbidden/);
  });

  it('maps GET for portal roles to library.portal', () => {
    expect(libraryActionForMethod('GET', ['parent'])).toBe('library.portal');
    expect(libraryActionForMethod('GET', ['librarian'])).toBe('library.read');
    expect(libraryActionForMethod('POST', ['parent'])).toBe('library.write');
  });
});
