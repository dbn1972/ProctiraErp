/**
 * PRC-M491: per-caller visibility for workflow instance lists.
 *
 * - Restricted entity types (disciplinary / counselling) are hidden from
 *   callers that do not hold one of the authorised roles.
 * - `mine` keeps only instances whose current state is assigned to the caller.
 * - Priority / SLA filters run server-side so pagination totals are correct.
 * - Metadata of restricted entity types is reduced to a whitelist.
 */
import type { WorkflowDefinitionEntity, WorkflowInstanceEntity } from './workflow-repository.js';

/** Entity type -> roles allowed to see instances of that type. */
export type RestrictedEntityTypes = Readonly<Record<string, readonly string[]>>;

/** Fail-closed default: only counselling/welfare roles see sensitive cases. */
export const DEFAULT_RESTRICTED_ENTITY_TYPES: RestrictedEntityTypes = {
  disciplinary_case: ['counsellor', 'principal', 'discipline_officer'],
  counselling_case: ['counsellor'],
};

/** Metadata keys that are safe to return for restricted entity types. */
export const SAFE_METADATA_KEYS = ['priority', 'slaDurationHours'] as const;

export type InstancePriority = 'high' | 'normal' | 'low';
export type InstanceSlaStatus = 'on_track' | 'at_risk' | 'overdue';

export function canSeeEntityType(
  entityType: string,
  actor: TransitionActor,
  restricted: RestrictedEntityTypes = DEFAULT_RESTRICTED_ENTITY_TYPES,
): boolean {
  const allowed = restricted[entityType];
  if (!allowed) return true;
  const roles = actor.roles.map((r) => r.toLowerCase());
  return allowed.some((r) => roles.includes(r.toLowerCase()));
}

export function priorityOf(instance: WorkflowInstanceEntity): InstancePriority {
  const p = (instance.metadata as Record<string, unknown> | null | undefined)?.['priority'];
  return p === 'high' || p === 'low' || p === 'normal' ? p : 'normal';
}

export function slaStatusOf(instance: WorkflowInstanceEntity, now: Date): InstanceSlaStatus {
  const meta = instance.metadata as Record<string, unknown> | null | undefined;
  const raw = meta?.['slaDurationHours'];
  const threshold = typeof raw === 'number' && raw > 0 ? raw : 48;
  const hours = (now.getTime() - instance.createdAt.getTime()) / 3_600_000;
  if (hours > threshold) return 'overdue';
  if (hours > threshold * 0.75) return 'at_risk';
  return 'on_track';
}

/** Strip non-whitelisted metadata from restricted entity types. */
export function maskInstance(
  instance: WorkflowInstanceEntity,
  restricted: RestrictedEntityTypes = DEFAULT_RESTRICTED_ENTITY_TYPES,
): WorkflowInstanceEntity {
  if (!restricted[instance.entityType] || !instance.metadata) return instance;
  const meta = instance.metadata as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of SAFE_METADATA_KEYS) if (key in meta) safe[key] = meta[key];
  return { ...instance, metadata: safe } as WorkflowInstanceEntity;
}

export interface VisibilityOptions {
  mine?: boolean;
  priority?: InstancePriority;
  slaStatus?: InstanceSlaStatus;
  restricted?: RestrictedEntityTypes;
  now?: Date;
}

export function filterVisibleInstances(
  instances: readonly WorkflowInstanceEntity[],
  definitions: ReadonlyMap<string, WorkflowDefinitionEntity>,
  actor: TransitionActor,
  options: VisibilityOptions = {},
): WorkflowInstanceEntity[] {
  const restricted = options.restricted ?? DEFAULT_RESTRICTED_ENTITY_TYPES;
  const now = options.now ?? new Date();
  return instances
    .filter((i) => canSeeEntityType(i.entityType, actor, restricted))
    .filter((i) => {
      if (!options.mine) return true;
      const state = definitions
        .get(i.workflowDefinitionId)
        ?.states.find((s) => s.id === i.currentStateId);
      return state ? isAssignee(state, actor) : false;
    })
    .filter((i) => !options.priority || priorityOf(i) === options.priority)
    .filter((i) => !options.slaStatus || slaStatusOf(i, now) === options.slaStatus)
    .map((i) => maskInstance(i, restricted));
}

/** PRC-M490: authenticated caller performing a transition over HTTP. */
export interface TransitionActor {
  id: string;
  roles: readonly string[];
}
/**
 * PRC-M490: does `actor` match the state's assignee rule? `area_role` is matched by role
 * name (fail closed) because area-hierarchy resolution is not available at this layer.
 */
export function isAssignee(
  state: { assigneeType: 'role' | 'user' | 'area_role'; assigneeId: string },
  actor: TransitionActor,
): boolean {
  if (state.assigneeType === 'user') return state.assigneeId === actor.id;
  const wanted = state.assigneeId.toLowerCase();
  return actor.roles.some((r) => r.toLowerCase() === wanted);
}
