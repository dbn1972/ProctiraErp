/**
 * @proctira/backend-policy - Policy and Compliance Service
 *
 * Provides policy management with:
 * - CRUD operations for policies (create, update, activate, deactivate)
 * - Policy types: data retention, password complexity, session timeout, rate limiting
 * - Policy evaluation engine with inheritance (platform → tenant → institution)
 * - Policy versioning with effective dates
 * - Policy assignments to scope targets
 *
 * Charter: Section 27 (Security and Compliance)
 */

// Plugin
export { policyPlugin } from './policy-plugin.js';
export type { PolicyPluginOptions } from './policy-plugin.js';

// Service
export { PolicyService } from './policy-service.js';

// Evaluation Engine
export { PolicyEvaluationEngine } from './policy-evaluation-engine.js';
export type { PolicyEvaluationContext } from './policy-evaluation-engine.js';

// Repository
export type {
  PolicyEntity,
  PolicyVersionEntity,
  PolicyAssignmentEntity,
  PolicyFilter,
  PolicyRepository,
} from './policy-repository.js';

// In-memory repository (for testing)
export { InMemoryPolicyRepository } from './in-memory-repository.js';

// Schemas
export {
  PolicyTypeEnum,
  PolicyStatusEnum,
  PolicyScopeEnum,
  DataRetentionRulesSchema,
  PasswordComplexityRulesSchema,
  SessionTimeoutRulesSchema,
  RateLimitingRulesSchema,
  PolicyRulesSchema,
  CreatePolicySchema,
  UpdatePolicySchema,
  PolicyParamsSchema,
  PolicyListQuerySchema,
  PolicyEvaluationRequestSchema,
  CreatePolicyAssignmentSchema,
  PolicyResponseSchema,
  PolicyListResponseSchema,
  PolicyEvaluationResponseSchema,
  PolicyVersionResponseSchema,
} from './schemas.js';
export type {
  PolicyType,
  PolicyStatus,
  PolicyScope,
  DataRetentionRules,
  PasswordComplexityRules,
  SessionTimeoutRules,
  RateLimitingRules,
  PolicyRules,
  CreatePolicyInput,
  UpdatePolicyInput,
  PolicyParams,
  PolicyListQuery,
  PolicyEvaluationRequest,
  CreatePolicyAssignmentInput,
  PolicyResponse,
  PolicyListResponse,
  PolicyEvaluationResponse,
  PolicyVersionResponse,
} from './schemas.js';

// Routes
export { registerPolicyRoutes } from './routes.js';
export type { PolicyRoutesOptions } from './routes.js';
