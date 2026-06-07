import { Type, type TString } from '@sinclair/typebox';

/**
 * ISO 8601 date format schema (YYYY-MM-DD).
 * Validates strings matching the ISO date pattern.
 */
export const DateSchema: TString = Type.String({
  pattern: '^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])$',
  description: 'ISO 8601 date (YYYY-MM-DD)',
});
