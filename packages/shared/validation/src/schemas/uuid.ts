import { Type, type TString } from '@sinclair/typebox';

/**
 * RFC 4122 / RFC 9562 UUID format schema (versions 1-8, RFC variant).
 * Accepts v4 as well as v5/v7 ids (PRC-L357); malformed strings are rejected.
 */
export const UuidSchema: TString = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  description: 'UUID identifier',
});
