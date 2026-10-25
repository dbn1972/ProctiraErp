/**
 * Compatibility Checker Unit Tests
 *
 * Tests semver range matching for plugin compatibility validation.
 */
import { describe, it, expect } from 'vitest';

import {
  parseSemver,
  compareSemver,
  checkCompatibility,
  validateCompatibility,
} from './compatibility.js';

describe('parseSemver', () => {
  it('should parse a valid semver string', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null });
  });

  it('should parse a semver with pre-release', () => {
    expect(parseSemver('2.0.0-beta.1')).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
      prerelease: 'beta.1',
    });
  });

  it('should return null for invalid semver', () => {
    expect(parseSemver('not-a-version')).toBeNull();
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('')).toBeNull();
  });
});

describe('compareSemver', () => {
  it('should compare major versions', () => {
    expect(
      compareSemver(
        { major: 2, minor: 0, patch: 0, prerelease: null },
        { major: 1, minor: 0, patch: 0, prerelease: null },
      ),
    ).toBe(1);
    expect(
      compareSemver(
        { major: 1, minor: 0, patch: 0, prerelease: null },
        { major: 2, minor: 0, patch: 0, prerelease: null },
      ),
    ).toBe(-1);
  });

  it('should compare minor versions', () => {
    expect(
      compareSemver(
        { major: 1, minor: 2, patch: 0, prerelease: null },
        { major: 1, minor: 1, patch: 0, prerelease: null },
      ),
    ).toBe(1);
  });

  it('should compare patch versions', () => {
    expect(
      compareSemver(
        { major: 1, minor: 0, patch: 2, prerelease: null },
        { major: 1, minor: 0, patch: 1, prerelease: null },
      ),
    ).toBe(1);
  });

  it('should return 0 for equal versions', () => {
    expect(
      compareSemver(
        { major: 1, minor: 2, patch: 3, prerelease: null },
        { major: 1, minor: 2, patch: 3, prerelease: null },
      ),
    ).toBe(0);
  });

  it('should rank pre-release lower than release', () => {
    expect(
      compareSemver(
        { major: 1, minor: 0, patch: 0, prerelease: 'beta' },
        { major: 1, minor: 0, patch: 0, prerelease: null },
      ),
    ).toBe(-1);
    expect(
      compareSemver(
        { major: 1, minor: 0, patch: 0, prerelease: null },
        { major: 1, minor: 0, patch: 0, prerelease: 'beta' },
      ),
    ).toBe(1);
  });

  it('orders pre-release identifiers per SemVer 2.0.0 §11 (PRC-L480)', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.2',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ].map((v) => parseSemver(v)!);
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareSemver(ordered[i]!, ordered[i + 1]!)).toBe(-1);
      expect(compareSemver(ordered[i + 1]!, ordered[i]!)).toBe(1);
    }
    expect(compareSemver(parseSemver('1.0.0-rc.1')!, parseSemver('1.0.0-rc.1')!)).toBe(0);
  });

  it('applies pre-release ordering in ranges (PRC-L480)', () => {
    expect(checkCompatibility('1.0.0-beta.2', '>=1.0.0-beta.1')).toBe(true);
    expect(checkCompatibility('1.0.0-alpha.9', '>=1.0.0-beta.1')).toBe(false);
  });
});

describe('checkCompatibility', () => {
  describe('exact version', () => {
    it('should match exact version', () => {
      expect(checkCompatibility('1.2.3', '1.2.3')).toBe(true);
    });

    it('should not match different version', () => {
      expect(checkCompatibility('1.2.4', '1.2.3')).toBe(false);
    });
  });

  describe('wildcard', () => {
    it('should match any version with wildcard', () => {
      expect(checkCompatibility('1.0.0', '*')).toBe(true);
      expect(checkCompatibility('99.99.99', '*')).toBe(true);
    });
  });

  describe('caret range (^)', () => {
    it('should match within caret range for major > 0', () => {
      expect(checkCompatibility('1.2.3', '^1.0.0')).toBe(true);
      expect(checkCompatibility('1.9.9', '^1.0.0')).toBe(true);
    });

    it('should not match outside caret range', () => {
      expect(checkCompatibility('2.0.0', '^1.0.0')).toBe(false);
      expect(checkCompatibility('0.9.9', '^1.0.0')).toBe(false);
    });

    it('should handle caret range for major 0', () => {
      expect(checkCompatibility('0.2.5', '^0.2.0')).toBe(true);
      expect(checkCompatibility('0.3.0', '^0.2.0')).toBe(false);
    });
  });

  describe('tilde range (~)', () => {
    it('should match within tilde range', () => {
      expect(checkCompatibility('1.2.5', '~1.2.3')).toBe(true);
      expect(checkCompatibility('1.2.3', '~1.2.3')).toBe(true);
    });

    it('should not match outside tilde range', () => {
      expect(checkCompatibility('1.3.0', '~1.2.3')).toBe(false);
      expect(checkCompatibility('1.2.2', '~1.2.3')).toBe(false);
    });
  });

  describe('comparison operators', () => {
    it('should handle >= operator', () => {
      expect(checkCompatibility('2.0.0', '>=1.0.0')).toBe(true);
      expect(checkCompatibility('1.0.0', '>=1.0.0')).toBe(true);
      expect(checkCompatibility('0.9.9', '>=1.0.0')).toBe(false);
    });

    it('should handle < operator', () => {
      expect(checkCompatibility('1.9.9', '<2.0.0')).toBe(true);
      expect(checkCompatibility('2.0.0', '<2.0.0')).toBe(false);
    });

    it('should handle compound range', () => {
      expect(checkCompatibility('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
      expect(checkCompatibility('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
      expect(checkCompatibility('0.9.0', '>=1.0.0 <2.0.0')).toBe(false);
    });
  });

  describe('union ranges (||) (PRC-L480)', () => {
    it('matches when any alternative matches', () => {
      expect(checkCompatibility('1.5.0', '^1.0.0 || ^2.0.0')).toBe(true);
      expect(checkCompatibility('2.3.0', '^1.0.0 || ^2.0.0')).toBe(true);
      expect(checkCompatibility('3.0.0', '^1.0.0 || ^2.0.0')).toBe(false);
    });

    it('supports compound alternatives', () => {
      expect(checkCompatibility('0.5.0', '>=0.1.0 <1.0.0 || >=2.0.0')).toBe(true);
      expect(checkCompatibility('1.5.0', '>=0.1.0 <1.0.0 || >=2.0.0')).toBe(false);
    });
  });

  describe('x-ranges and partial versions (PRC-L480)', () => {
    it('handles 1.x and 1', () => {
      expect(checkCompatibility('1.4.0', '1.x')).toBe(true);
      expect(checkCompatibility('1.0.0', '1')).toBe(true);
      expect(checkCompatibility('2.0.0', '1.x')).toBe(false);
      expect(checkCompatibility('0.9.9', '1')).toBe(false);
    });

    it('handles 1.2.* and 1.2', () => {
      expect(checkCompatibility('1.2.9', '1.2.*')).toBe(true);
      expect(checkCompatibility('1.2.0', '1.2')).toBe(true);
      expect(checkCompatibility('1.3.0', '1.2.*')).toBe(false);
      expect(checkCompatibility('1.1.9', '1.2')).toBe(false);
    });

    it('handles operators with partial versions', () => {
      expect(checkCompatibility('2.0.0', '>1.x')).toBe(true);
      expect(checkCompatibility('1.9.9', '>1.x')).toBe(false);
      expect(checkCompatibility('1.9.9', '<=1.x')).toBe(true);
      expect(checkCompatibility('2.0.0', '<=1.x')).toBe(false);
    });

    it('handles caret and tilde with partial versions', () => {
      expect(checkCompatibility('1.9.0', '^1.x')).toBe(true);
      expect(checkCompatibility('2.0.0', '^1.x')).toBe(false);
      expect(checkCompatibility('1.2.7', '~1.2')).toBe(true);
      expect(checkCompatibility('1.3.0', '~1.2')).toBe(false);
    });
  });

  describe('hyphen ranges (PRC-L480)', () => {
    it('is inclusive at both ends', () => {
      expect(checkCompatibility('1.2.3', '1.2.3 - 1.4.0')).toBe(true);
      expect(checkCompatibility('1.4.0', '1.2.3 - 1.4.0')).toBe(true);
      expect(checkCompatibility('1.4.1', '1.2.3 - 1.4.0')).toBe(false);
      expect(checkCompatibility('1.2.2', '1.2.3 - 1.4.0')).toBe(false);
    });

    it('treats a partial upper bound as the whole x-range', () => {
      expect(checkCompatibility('1.4.9', '1.2.3 - 1.4')).toBe(true);
      expect(checkCompatibility('1.5.0', '1.2.3 - 1.4')).toBe(false);
    });
  });

  describe('spaced operators (PRC-L480)', () => {
    it('accepts whitespace between operator and version', () => {
      expect(checkCompatibility('1.5.0', '>= 1.0.0 < 2.0.0')).toBe(true);
      expect(checkCompatibility('2.0.0', '>= 1.0.0 < 2.0.0')).toBe(false);
      expect(checkCompatibility('0.9.0', '>= 1.0.0 < 2.0.0')).toBe(false);
    });
  });

  describe('invalid inputs', () => {
    it('should return false for invalid product version', () => {
      expect(checkCompatibility('invalid', '^1.0.0')).toBe(false);
    });

    it('should return false for invalid range target', () => {
      expect(checkCompatibility('1.0.0', '^invalid')).toBe(false);
    });
  });
});

describe('validateCompatibility', () => {
  it('should return compatible result with message', () => {
    const result = validateCompatibility('2.0.0', '^2.0.0');
    expect(result.compatible).toBe(true);
    expect(result.productVersion).toBe('2.0.0');
    expect(result.supportedRange).toBe('^2.0.0');
    expect(result.message).toContain('compatible');
  });

  it('should return incompatible result with descriptive message', () => {
    const result = validateCompatibility('1.0.0', '^2.0.0');
    expect(result.compatible).toBe(false);
    expect(result.message).toContain('^2.0.0');
    expect(result.message).toContain('1.0.0');
  });
});
