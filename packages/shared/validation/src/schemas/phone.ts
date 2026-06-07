import { Type, type TString } from '@sinclair/typebox';

/**
 * Phone number schema.
 * Accepts international format with optional + prefix, digits, spaces, hyphens, and parentheses.
 */
export const PhoneSchema: TString = Type.String({
  pattern: '^\\+?[\\d\\s\\-()]{7,20}$',
  description: 'Phone number (international format)',
});
