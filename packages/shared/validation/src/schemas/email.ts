import { Type, type TString } from '@sinclair/typebox';

/**
 * Email format schema with max length constraint.
 * Validates strings matching a standard email pattern.
 */
export const EmailSchema: TString = Type.String({
  pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
  maxLength: 254,
  description: 'email address',
});
