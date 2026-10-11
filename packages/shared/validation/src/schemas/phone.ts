import { Type, type TString } from '@sinclair/typebox';
import { FormatRegistry } from '@sinclair/typebox';

/**
 * Syntactic phone pattern: optional + prefix, then digits, spaces, hyphens and
 * parentheses. The registered `dialable-phone` format below adds the semantic
 * rule that there must be at least 7 actual digits (separators do not count),
 * so junk such as '(((((((' is rejected (PRC-L588).
 */
const PHONE_PATTERN = '^\\+?[\\d\\s\\-()]{7,20}$';
const PHONE_REGEX = new RegExp(PHONE_PATTERN);

/** Minimum number of real digits for a dialable number (national min). */
const MIN_PHONE_DIGITS = 7;
/** Maximum per E.164 (country code + national number). */
const MAX_PHONE_DIGITS = 15;

/**
 * Returns true only when the value matches the phone pattern AND contains
 * between 7 and 15 actual digits. Fail-closed for everything else.
 */
export function isDialablePhone(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (!PHONE_REGEX.test(value)) return false;
  const digitCount = (value.match(/\d/g) ?? []).length;
  return digitCount >= MIN_PHONE_DIGITS && digitCount <= MAX_PHONE_DIGITS;
}

// Register once (idempotent).
FormatRegistry.Set('dialable-phone', isDialablePhone);

/**
 * Phone number schema.
 * Accepts international format with optional + prefix, digits, spaces, hyphens
 * and parentheses, and requires at least 7 real digits (<=15 per E.164).
 */
export const PhoneSchema: TString = Type.String({
  pattern: PHONE_PATTERN,
  format: 'dialable-phone',
  description: 'Phone number (international format, 7-15 digits)',
});
