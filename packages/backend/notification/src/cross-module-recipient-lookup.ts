/**
 * Cross-module notification recipient lookup.
 *
 * Expands role / area / institution criteria via injected per-schema ports,
 * then merges bare UUIDs in memory (OR semantics — same as the in-memory
 * repository). Never issues SQL JOINs or FKs across Postgres schemas.
 *
 * Pattern mirrors {@link CrossModuleReportDataSource}.
 */
import type { RecipientQuery } from './schemas.js';

/** Structural port — resolve users holding any of the given role IDs. */
export interface RecipientRolePort {
  findUserIdsByRoleIds(tenantId: string, roleIds: string[]): Promise<string[]>;
}

/** Structural port — resolve users scoped to any of the given area IDs. */
export interface RecipientAreaPort {
  findUserIdsByAreaIds(tenantId: string, areaIds: string[]): Promise<string[]>;
}

/** Structural port — resolve users scoped to any of the given institution IDs. */
export interface RecipientInstitutionPort {
  findUserIdsByInstitutionIds(
    tenantId: string,
    institutionIds: string[],
  ): Promise<string[]>;
}

export interface CrossModuleRecipientLookupDeps {
  roles?: RecipientRolePort;
  areas?: RecipientAreaPort;
  institutions?: RecipientInstitutionPort;
}

/**
 * Injectable lookup used by {@link PrismaNotificationRepository.resolveRecipients}.
 */
export interface NotificationRecipientLookup {
  /**
   * Expand role / area / institution criteria into user IDs.
   * Explicit `userIds` on the query are left to the repository to merge.
   */
  expandRoleAreaInstitution(
    tenantId: string,
    query: Pick<RecipientQuery, 'roleIds' | 'areaIds' | 'institutionIds'>,
  ): Promise<string[]>;
}

/**
 * Composes optional domain ports with sequential calls + in-memory UUID merge.
 */
export class CrossModuleNotificationRecipientLookup
  implements NotificationRecipientLookup
{
  constructor(private readonly deps: CrossModuleRecipientLookupDeps = {}) {}

  async expandRoleAreaInstitution(
    tenantId: string,
    query: Pick<RecipientQuery, 'roleIds' | 'areaIds' | 'institutionIds'>,
  ): Promise<string[]> {
    const resolved = new Set<string>();

    if (query.roleIds && query.roleIds.length > 0 && this.deps.roles) {
      const ids = await this.deps.roles.findUserIdsByRoleIds(
        tenantId,
        query.roleIds,
      );
      for (const id of ids) resolved.add(id);
    }

    if (query.areaIds && query.areaIds.length > 0 && this.deps.areas) {
      const ids = await this.deps.areas.findUserIdsByAreaIds(
        tenantId,
        query.areaIds,
      );
      for (const id of ids) resolved.add(id);
    }

    if (
      query.institutionIds &&
      query.institutionIds.length > 0 &&
      this.deps.institutions
    ) {
      const ids = await this.deps.institutions.findUserIdsByInstitutionIds(
        tenantId,
        query.institutionIds,
      );
      for (const id of ids) resolved.add(id);
    }

    return Array.from(resolved);
  }
}

export function createNotificationRecipientLookup(
  deps: CrossModuleRecipientLookupDeps = {},
): NotificationRecipientLookup {
  return new CrossModuleNotificationRecipientLookup(deps);
}
