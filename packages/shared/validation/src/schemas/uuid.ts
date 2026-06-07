import { Type, type TString } from '@sinclair/typebox';

/**
 * UUID v4 format schema.
 * Validates strings matching the UUID v4 pattern.
 */
export const UuidSchema: TString = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  description: 'UUID v4 identifier',
});
