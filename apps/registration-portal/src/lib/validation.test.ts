/**
 * Unit tests for the registration-portal validation utilities.
 */
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_FILE_TYPES,
  DEFAULT_MAX_FILE_SIZE,
  institutionTypeToApplySlug,
  isValidDateOfBirth,
  isValidEmail,
  isValidInstitutionId,
  isValidPhone,
  isValidTrackingNumber,
  validateFile,
  validateRequiredFields,
} from './validation';

/** Builds a fake File object with a controllable size + MIME type. */
function makeFile(name: string, type: string, size: number): File {
  // Construct a Blob of the given size and wrap it as a File.
  const buffer = new Uint8Array(size);
  return new File([buffer], name, { type });
}

describe('validateFile', () => {
  it('accepts a small JPEG', () => {
    const file = makeFile('photo.jpg', 'image/jpeg', 1024);
    expect(validateFile(file)).toEqual({ valid: true });
  });

  it('rejects a non-allowed MIME type', () => {
    const file = makeFile('virus.exe', 'application/x-msdownload', 1024);
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_type');
  });

  it('rejects files larger than the maximum size', () => {
    const file = makeFile('big.pdf', 'application/pdf', DEFAULT_MAX_FILE_SIZE + 1);
    const result = validateFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('file_too_large');
  });

  it('honours the configured allowed-types set', () => {
    const file = makeFile('photo.tiff', 'image/tiff', 1024);
    const allowed = new Set(['image/tiff']);
    expect(validateFile(file, DEFAULT_MAX_FILE_SIZE, allowed)).toEqual({ valid: true });
  });

  it('matches the backend allowed file types', () => {
    expect(ALLOWED_FILE_TYPES.has('image/jpeg')).toBe(true);
    expect(ALLOWED_FILE_TYPES.has('application/pdf')).toBe(true);
    expect(ALLOWED_FILE_TYPES.has('application/msword')).toBe(true);
  });
});

describe('validateRequiredFields', () => {
  it('flags missing fields', () => {
    const errors = validateRequiredFields({ a: '', b: 'value' }, ['a', 'b', 'c']);
    expect(errors).toEqual({ a: 'required', c: 'required' });
  });

  it('returns an empty map when everything is present', () => {
    const errors = validateRequiredFields({ a: 'x', b: 'y' }, ['a', 'b']);
    expect(errors).toEqual({});
  });
});

describe('isValidEmail', () => {
  it.each(['user@example.com', 'a.b+tag@sub.example.org'])('accepts %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });
  it.each(['', 'no-at-sign', 'spaces in@example.com'])('rejects %s', (email) => {
    expect(isValidEmail(email)).toBe(false);
  });
});

describe('isValidPhone', () => {
  it('accepts common formats', () => {
    expect(isValidPhone('+1 555-555-5555')).toBe(true);
    expect(isValidPhone('(555) 555-5555')).toBe(true);
  });
  it('rejects too-short input', () => {
    expect(isValidPhone('123')).toBe(false);
  });
});

describe('isValidTrackingNumber', () => {
  it('matches REG-XXXXXXXX', () => {
    expect(isValidTrackingNumber('REG-A1B2C3D4')).toBe(true);
    expect(isValidTrackingNumber('reg-a1b2c3d4')).toBe(true);
  });
  it('rejects malformed values', () => {
    expect(isValidTrackingNumber('REG-1')).toBe(false);
    expect(isValidTrackingNumber('A1B2C3D4')).toBe(false);
  });
});

describe('isValidDateOfBirth', () => {
  it('accepts YYYY-MM-DD calendar dates', () => {
    expect(isValidDateOfBirth('2018-03-15')).toBe(true);
    expect(isValidDateOfBirth('2000-01-01')).toBe(true);
  });
  it('rejects malformed and impossible dates', () => {
    expect(isValidDateOfBirth('2018/03/15')).toBe(false);
    expect(isValidDateOfBirth('2024-02-31')).toBe(false);
    expect(isValidDateOfBirth('not-a-date')).toBe(false);
  });
});

describe('isValidInstitutionId', () => {
  it('accepts RFC-4122 UUIDs', () => {
    expect(isValidInstitutionId('11111111-1111-4111-8111-111111111111')).toBe(true);
  });
  it('rejects empty and non-UUID values', () => {
    expect(isValidInstitutionId('')).toBe(false);
    expect(isValidInstitutionId('not-a-uuid')).toBe(false);
    expect(isValidInstitutionId('11111111111141118111111111111111')).toBe(false);
  });
});

describe('institutionTypeToApplySlug', () => {
  it('maps known type names', () => {
    expect(institutionTypeToApplySlug('Primary School')).toBe('primary');
    expect(institutionTypeToApplySlug('Secondary')).toBe('secondary');
    expect(institutionTypeToApplySlug('TVET College')).toBe('tvet');
    expect(institutionTypeToApplySlug('Preschool')).toBe('preschool');
  });
  it('defaults unknown types to primary', () => {
    expect(institutionTypeToApplySlug(undefined)).toBe('primary');
    expect(institutionTypeToApplySlug('Other')).toBe('primary');
  });
});
