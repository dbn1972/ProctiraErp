/**
 * Typebox schemas for Policy Service request/response validation.
 *
 * Defines schemas for:
 * - CreatePolicy (body)
 * - UpdatePolicy (body)
 * - PolicyResponse (response)
 * - PolicyEvaluationRequest (body)
 * - PolicyEvaluationResponse (response)
 *
 * Charter: Section 27 (Security and Compliance)
 */
import { Type, type Static } from '@sinclair/typebox';

// ─── Policy Types ────────────────────────────────────────────────────────────

/**
 * Supported policy types in the platform.
 */
export const PolicyTypeEnum = Type.Union([
  Type.Literal('data_retention'),
  Type.Literal('password_complexity'),
  Type.Literal('session_timeout'),
  Type.Literal('rate_limiting'),
]);

export type PolicyType = Static<typeof PolicyTypeEnum>;

/**
 * Policy status values.
 */
export const PolicyStatusEnum = Type.Union([
  Type.Literal('draft'),
  Type.Literal('active'),
  Type.Literal('inactive'),
]);

export type PolicyStatus = Static<typeof PolicyStatusEnum>;

/**
 * Policy scope levels for inheritance (platform → tenant → institution).
 */
export const PolicyScopeEnum = Type.Union([
  Type.Literal('platform'),
  Type.Literal('tenant'),
  Type.Literal('institution'),
]);

export type PolicyScope = Static<typeof PolicyScopeEnum>;

// ─── Policy Rule Schemas (per type) ─────────────────────────────────────────

/**
 * Data retention policy rules.
 */
export const DataRetentionRulesSchema = Type.Object({
  retentionDays: Type.Number({ minimum: 1, maximum: 36500, description: 'Number of days to retain data' }),
  archiveAfterDays: Type.Optional(Type.Number({ minimum: 1, description: 'Days before archiving' })),
  deleteAfterArchive: Type.Optional(Type.Boolean({ description: 'Whether to delete after archive period' })),
  entityTypes: Type.Optional(Type.Array(Type.String(), { description: 'Entity types this policy applies to' })),
});

export type DataRetentionRules = Static<typeof DataRetentionRulesSchema>;

/**
 * Password complexity policy rules.
 */
export const PasswordComplexityRulesSchema = Type.Object({
  minLength: Type.Number({ minimum: 4, maximum: 128, description: 'Minimum password length' }),
  maxLength: Type.Optional(Type.Number({ minimum: 8, maximum: 256, description: 'Maximum password length' })),
  requireUppercase: Type.Boolean({ description: 'Require at least one uppercase letter' }),
  requireLowercase: Type.Boolean({ description: 'Require at least one lowercase letter' }),
  requireNumbers: Type.Boolean({ description: 'Require at least one number' }),
  requireSpecialChars: Type.Boolean({ description: 'Require at least one special character' }),
  preventReuse: Type.Optional(Type.Number({ minimum: 0, maximum: 24, description: 'Number of previous passwords to prevent reuse' })),
  maxAgeDays: Type.Optional(Type.Number({ minimum: 1, maximum: 365, description: 'Maximum password age in days' })),
});

export type PasswordComplexityRules = Static<typeof PasswordComplexityRulesSchema>;

/**
 * Session timeout policy rules.
 */
export const SessionTimeoutRulesSchema = Type.Object({
  idleTimeoutMinutes: Type.Number({ minimum: 1, maximum: 1440, description: 'Idle timeout in minutes' }),
  absoluteTimeoutMinutes: Type.Number({ minimum: 5, maximum: 1440, description: 'Absolute session timeout in minutes' }),
  warnBeforeTimeoutMinutes: Type.Optional(Type.Number({ minimum: 1, description: 'Minutes before timeout to warn user' })),
  allowRememberMe: Type.Optional(Type.Boolean({ description: 'Allow remember-me extended sessions' })),
  rememberMeDays: Type.Optional(Type.Number({ minimum: 1, maximum: 30, description: 'Remember-me duration in days' })),
});

export type SessionTimeoutRules = Static<typeof SessionTimeoutRulesSchema>;

/**
 * Rate limiting policy rules.
 */
export const RateLimitingRulesSchema = Type.Object({
  windowMs: Type.Number({ minimum: 1000, maximum: 3600000, description: 'Rate limit window in milliseconds' }),
  maxRequests: Type.Number({ minimum: 1, maximum: 100000, description: 'Maximum requests per window' }),
  keyStrategy: Type.Optional(Type.Union([
    Type.Literal('ip'),
    Type.Literal('user'),
    Type.Literal('tenant'),
    Type.Literal('api_key'),
  ], { description: 'How to identify rate limit subjects' })),
  skipSuccessful: Type.Optional(Type.Boolean({ description: 'Only count failed requests' })),
  endpoints: Type.Optional(Type.Array(Type.String(), { description: 'Specific endpoints to rate limit' })),
});

export type RateLimitingRules = Static<typeof RateLimitingRulesSchema>;

/**
 * Union of all policy rule types.
 */
export const PolicyRulesSchema = Type.Union([
  DataRetentionRulesSchema,
  PasswordComplexityRulesSchema,
  SessionTimeoutRulesSchema,
  RateLimitingRulesSchema,
]);

export type PolicyRules = Static<typeof PolicyRulesSchema>;

// ─── CRUD Schemas ────────────────────────────────────────────────────────────

/**
 * Schema for creating a new policy.
 */
export const CreatePolicySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255, description: 'Policy name' }),
  description: Type.Optional(Type.String({ maxLength: 1000, description: 'Policy description' })),
  type: PolicyTypeEnum,
  scope: PolicyScopeEnum,
  rules: Type.Record(Type.String(), Type.Unknown(), { description: 'Policy rules (validated per type)' }),
  effectiveFrom: Type.Optional(Type.String({ format: 'date-time', description: 'When the policy becomes effective (ISO 8601)' })),
  effectiveUntil: Type.Optional(Type.String({ format: 'date-time', description: 'When the policy expires (ISO 8601)' })),
  priority: Type.Optional(Type.Number({ minimum: 0, maximum: 1000, default: 100, description: 'Priority for conflict resolution (higher wins)' })),
});

export type CreatePolicyInput = Static<typeof CreatePolicySchema>;

/**
 * Schema for updating an existing policy.
 */
export const UpdatePolicySchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255, description: 'Policy name' })),
  description: Type.Optional(Type.String({ maxLength: 1000, description: 'Policy description' })),
  rules: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Policy rules (validated per type)' })),
  effectiveFrom: Type.Optional(Type.String({ format: 'date-time', description: 'When the policy becomes effective' })),
  effectiveUntil: Type.Optional(Type.String({ format: 'date-time', description: 'When the policy expires' })),
  priority: Type.Optional(Type.Number({ minimum: 0, maximum: 1000, description: 'Priority for conflict resolution' })),
});

export type UpdatePolicyInput = Static<typeof UpdatePolicySchema>;

/**
 * Schema for policy ID path parameter.
 */
export const PolicyParamsSchema = Type.Object({
  id: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Policy UUID',
  }),
});

export type PolicyParams = Static<typeof PolicyParamsSchema>;

/**
 * Schema for policy list query parameters.
 */
export const PolicyListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1, description: 'Page number (1-based)' })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20, description: 'Items per page' })),
  type: Type.Optional(PolicyTypeEnum),
  scope: Type.Optional(PolicyScopeEnum),
  status: Type.Optional(PolicyStatusEnum),
  search: Type.Optional(Type.String({ description: 'Search by name or description' })),
  sortBy: Type.Optional(Type.String({ enum: ['name', 'type', 'createdAt', 'priority'], default: 'name', description: 'Sort field' })),
  sortOrder: Type.Optional(Type.String({ enum: ['asc', 'desc'], default: 'asc', description: 'Sort direction' })),
});

export type PolicyListQuery = Static<typeof PolicyListQuerySchema>;

// ─── Policy Evaluation Schemas ───────────────────────────────────────────────

/**
 * Schema for policy evaluation request.
 */
export const PolicyEvaluationRequestSchema = Type.Object({
  type: PolicyTypeEnum,
  tenantId: Type.Optional(Type.String({ description: 'Tenant ID for scoped evaluation' })),
  institutionId: Type.Optional(Type.String({ description: 'Institution ID for scoped evaluation' })),
});

export type PolicyEvaluationRequest = Static<typeof PolicyEvaluationRequestSchema>;

// ─── Policy Assignment Schema ────────────────────────────────────────────────

/**
 * Schema for assigning a policy to a scope target.
 */
export const CreatePolicyAssignmentSchema = Type.Object({
  policyId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Policy UUID to assign',
  }),
  targetType: Type.Union([
    Type.Literal('platform'),
    Type.Literal('tenant'),
    Type.Literal('institution'),
  ], { description: 'Target scope type' }),
  targetId: Type.Optional(Type.String({ description: 'Target entity ID (null for platform scope)' })),
});

export type CreatePolicyAssignmentInput = Static<typeof CreatePolicyAssignmentSchema>;

// ─── Response Schemas ────────────────────────────────────────────────────────

/**
 * Schema for policy response object.
 */
export const PolicyResponseSchema = Type.Object({
  id: Type.String({ description: 'Policy UUID' }),
  name: Type.String({ description: 'Policy name' }),
  description: Type.Union([Type.String(), Type.Null()], { description: 'Policy description' }),
  type: PolicyTypeEnum,
  scope: PolicyScopeEnum,
  status: PolicyStatusEnum,
  rules: Type.Record(Type.String(), Type.Unknown(), { description: 'Policy rules' }),
  version: Type.Number({ description: 'Current version number' }),
  effectiveFrom: Type.Union([Type.String(), Type.Null()], { description: 'Effective start date' }),
  effectiveUntil: Type.Union([Type.String(), Type.Null()], { description: 'Effective end date' }),
  priority: Type.Number({ description: 'Priority for conflict resolution' }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  updatedAt: Type.String({ description: 'Last update timestamp (ISO 8601)' }),
});

export type PolicyResponse = Static<typeof PolicyResponseSchema>;

/**
 * Schema for paginated policy list response.
 */
export const PolicyListResponseSchema = Type.Object({
  data: Type.Array(PolicyResponseSchema),
  meta: Type.Object({
    page: Type.Number({ description: 'Current page number' }),
    pageSize: Type.Number({ description: 'Items per page' }),
    totalItems: Type.Number({ description: 'Total number of items' }),
    totalPages: Type.Number({ description: 'Total number of pages' }),
  }),
});

export type PolicyListResponse = Static<typeof PolicyListResponseSchema>;

/**
 * Schema for policy evaluation response.
 */
export const PolicyEvaluationResponseSchema = Type.Object({
  effectivePolicy: Type.Union([PolicyResponseSchema, Type.Null()], { description: 'The effective policy after inheritance resolution' }),
  inheritanceChain: Type.Array(Type.Object({
    scope: PolicyScopeEnum,
    policyId: Type.Union([Type.String(), Type.Null()]),
    policyName: Type.Union([Type.String(), Type.Null()]),
  }), { description: 'Policies at each inheritance level' }),
  mergedRules: Type.Record(Type.String(), Type.Unknown(), { description: 'Merged rules from all applicable policies' }),
});

export type PolicyEvaluationResponse = Static<typeof PolicyEvaluationResponseSchema>;

/**
 * Schema for policy version response.
 */
export const PolicyVersionResponseSchema = Type.Object({
  id: Type.String({ description: 'Version UUID' }),
  policyId: Type.String({ description: 'Parent policy UUID' }),
  version: Type.Number({ description: 'Version number' }),
  rules: Type.Record(Type.String(), Type.Unknown(), { description: 'Rules at this version' }),
  effectiveFrom: Type.Union([Type.String(), Type.Null()], { description: 'Effective start date' }),
  effectiveUntil: Type.Union([Type.String(), Type.Null()], { description: 'Effective end date' }),
  createdAt: Type.String({ description: 'Creation timestamp (ISO 8601)' }),
  createdBy: Type.Union([Type.String(), Type.Null()], { description: 'User who created this version' }),
});

export type PolicyVersionResponse = Static<typeof PolicyVersionResponseSchema>;
