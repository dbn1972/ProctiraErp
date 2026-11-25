/**
 * PRC-L559: plugin analytics metadata and webhook delivery listings must not
 * persist or echo personal data.
 *
 * `redactPayload` returns a bounded copy:
 * - values under a personal-data key name (email, phone, name, address, date
 *   of birth, national ids, contact/guardian details, location, health, money
 *   and credentials) become {@link REDACTED};
 * - email addresses and phone numbers inside other string values are masked;
 * - strings are cut to {@link MAX_STRING}, objects to {@link MAX_KEYS} keys,
 *   arrays to {@link MAX_ITEMS} items and nesting to {@link MAX_DEPTH}.
 * Ids (`*Id`, `*_id`) and other attributes pass through unchanged.
 */
export const REDACTED = '[REDACTED]';
export const MAX_STRING = 256;
export const MAX_KEYS = 50;
export const MAX_ITEMS = 50;
export const MAX_DEPTH = 4;

const PERSONAL_KEY_PARTS = [
  'email',
  'phone',
  'mobile',
  'name',
  'address',
  'street',
  'postcode',
  'pincode',
  'dateofbirth',
  'birth',
  'aadhaar',
  'aadhar',
  'apaar',
  'passport',
  'nationalid',
  'ssn',
  'guardian',
  'parent',
  'contact',
  'ipaddress',
  'location',
  'latitude',
  'longitude',
  'geo',
  'health',
  'medical',
  'diagnosis',
  'allergy',
  'salary',
  'income',
  'bank',
  'account',
  'card',
  'iban',
  'password',
  'token',
  'secret',
  'otp',
  'authorization',
  'cookie',
];

/** Short names matched exactly (as substrings they hit unrelated words). */
const PERSONAL_KEYS_EXACT = new Set(['dob', 'pan', 'ip', 'zip', 'lat', 'lng', 'lon']);

const EMAIL_IN_TEXT = /[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/gi;
// Not inside a longer token (UUIDs, codes): no word char or hyphen on either side.
const PHONE_IN_TEXT = /(?<![\w-])\+?\d[\d\s().-]{7,}\d(?![\w-])/g;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_.-]/g, '');
}

/** Ids are not personal attributes on their own (DR47 ids-only principle). */
function isIdKey(key: string): boolean {
  return /(^id$|Id$|_id$|Ids$|_ids$)/.test(key);
}

export function isPersonalKey(key: string): boolean {
  if (isIdKey(key)) return false;
  const k = normalizeKey(key);
  return PERSONAL_KEYS_EXACT.has(k) || PERSONAL_KEY_PARTS.some((part) => k.includes(part));
}

function redactString(value: string): string {
  const masked = value.replace(EMAIL_IN_TEXT, REDACTED).replace(PHONE_IN_TEXT, REDACTED);
  return masked.length > MAX_STRING ? `${masked.slice(0, MAX_STRING)}…` : masked;
}

function redactValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map((item) => redactValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    return redactObject(value as Record<string, unknown>, depth + 1);
  }
  return REDACTED;
}

function redactObject(input: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input).slice(0, MAX_KEYS)) {
    if (isPersonalKey(key)) out[key] = REDACTED;
    else if (isIdKey(key) && typeof value === 'string') out[key] = value.slice(0, MAX_STRING);
    else out[key] = redactValue(value, depth);
  }
  return out;
}

export function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return redactObject(payload, 0);
}
