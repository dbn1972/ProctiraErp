/**
 * JWT-only actor extraction (G-102).
 *
 * Actor identity MUST come from the verified JWT payload (`request.user`) only.
 * Client-supplied headers such as `x-user-id` / `x-actor` are forgeable and must
 * never influence the returned actor.
 */
import type { RoleAssignment } from '@proctira/auth';

/** Minimal request shape — FastifyRequest or a test double. */
export interface ActorRequest {
  user?: {
    sub?: string;
    tenantId?: string;
    roles?: RoleAssignment[];
  };
  headers?: Record<string, string | string[] | undefined>;
}

export interface Actor {
  userId: string;
  tenantId: string;
  roles: RoleAssignment[];
}

/**
 * Returns the authenticated actor from JWT claims only.
 * Ignores any actor-related request headers.
 */
export function getActor(request: ActorRequest): Actor {
  const user = request.user;
  return {
    userId: user?.sub ?? '',
    tenantId: user?.tenantId ?? '',
    roles: user?.roles ?? [],
  };
}
