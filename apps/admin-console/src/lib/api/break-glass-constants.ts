/**
 * Break-glass constants that are safe for both client and server components.
 * Kept separate from `break-glass.ts` (which uses `next/headers`) so the
 * request form can import the use-case catalogue without pulling server-only
 * code into the client bundle.
 */

export const BREAK_GLASS_USE_CASES = [
  'Production incident triage',
  'Customer-requested support',
  'Scheduled maintenance',
  'Compliance audit / investigation',
  'Data recovery / restoration',
  'Security incident response',
] as const;

export type BreakGlassUseCase = (typeof BREAK_GLASS_USE_CASES)[number];

/** 4-hour ceiling per Section 41 policy. */
export const BREAK_GLASS_MAX_MINUTES = 240;
