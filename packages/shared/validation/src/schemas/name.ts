import { Type, type TString } from '@sinclair/typebox';

/**
 * Name schema - non-empty string with max length.
 * Suitable for person names, entity names, etc.
 */
export const NameSchema: TString = Type.String({
  minLength: 1,
  maxLength: 255,
  description: 'Non-empty name (max 255 characters)',
});
