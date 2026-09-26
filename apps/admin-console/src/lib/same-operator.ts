/** Session fields that identify the signed-in platform operator. */
export interface OperatorIdentity {
  email?: string | null;
  sub?: string | null;
  displayName?: string | null;
}

/**
 * True when a break-glass requester string is the signed-in operator.
 * Compares email, subject, and display name so the queue can hide self-approval.
 */
export function requesterMatchesSession(requester: string, user: OperatorIdentity): boolean {
  const needle = requester.trim().toLowerCase();
  if (!needle) return false;
  for (const candidate of [user.email, user.sub, user.displayName]) {
    if (typeof candidate === 'string' && candidate.trim().toLowerCase() === needle) {
      return true;
    }
  }
  return false;
}
