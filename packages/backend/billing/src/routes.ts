/**
 * Billing Routes
 *
 * Plan Management:
 * POST   /billing/plans                     - Create a new plan
 * PUT    /billing/plans/:id                  - Update a plan
 * GET    /billing/plans                      - List plans (paginated, filterable)
 * GET    /billing/plans/:id                  - Get a single plan
 *
 * Subscription Lifecycle:
 * POST   /billing/subscriptions              - Subscribe a tenant to a plan
 * GET    /billing/subscriptions/:id          - Get a subscription
 * POST   /billing/subscriptions/:id/activate - Activate a trial subscription
 * POST   /billing/subscriptions/:id/suspend  - Suspend a subscription
 * POST   /billing/subscriptions/:id/cancel   - Cancel a subscription
 * POST   /billing/subscriptions/:id/reactivate - Reactivate a suspended subscription
 * POST   /billing/subscriptions/:id/upgrade  - Upgrade plan
 * POST   /billing/subscriptions/:id/downgrade - Downgrade plan
 *
 * Entitlements & Usage:
 * POST   /billing/entitlements/check         - Check feature entitlement
 * POST   /billing/usage/record               - Record usage and enforce quota
 * POST   /billing/usage/query                - Get usage for a metric
 *
 * Charter: Section 10 (Subscription, Entitlements, Feature Control)
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { BillingService } from './billing-service.js';
import type { PlanEntity, SubscriptionEntity } from './billing-repository.js';
import {
  CreatePlanSchema,
  UpdatePlanSchema,
  PlanParamsSchema,
  PlanListQuerySchema,
  CreateSubscriptionSchema,
  SubscriptionParamsSchema,
  ChangePlanSchema,
  CheckEntitlementSchema,
  RecordUsageSchema,
  GetUsageSchema,
  type CreatePlanInput,
  type UpdatePlanInput,
  type PlanParams,
  type PlanListQuery,
  type CreateSubscriptionInput,
  type SubscriptionParams,
  type ChangePlanInput,
  type CheckEntitlementInput,
  type RecordUsageInput,
  type GetUsageInput,
} from './schemas.js';

/**
 * Options for registering billing routes.
 */
export interface BillingRoutesOptions {
  billingService: BillingService;
  /** Route prefix (default: '/billing') */
  prefix?: string;
}

/**
 * Formats a plan entity to the API response shape.
 */
function formatPlanResponse(entity: PlanEntity) {
  return {
    id: entity.id,
    name: entity.name,
    description: entity.description,
    tier: entity.tier,
    status: entity.status,
    features: entity.features,
    quotas: entity.quotas,
    priceMonthly: entity.priceMonthly,
    priceYearly: entity.priceYearly,
    trialDays: entity.trialDays,
    sortOrder: entity.sortOrder,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Register billing routes on a Fastify instance.
 */
export async function registerBillingRoutes(
  fastify: FastifyInstance,
  options: BillingRoutesOptions,
): Promise<void> {
  const { billingService, prefix = '/billing' } = options;

  // ─── Plan Routes ───────────────────────────────────────────────────────

  /**
   * POST /billing/plans
   * Create a new plan.
   */
  fastify.post(
    `${prefix}/plans`,
    async function createPlanHandler(
      request: FastifyRequest<{ Body: CreatePlanInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreatePlanSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      try {
        const plan = await billingService.createPlan(result.data);
        return reply.status(201).send(formatPlanResponse(plan));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /billing/plans/:id
   * Update an existing plan.
   */
  fastify.put(
    `${prefix}/plans/:id`,
    async function updatePlanHandler(
      request: FastifyRequest<{ Params: PlanParams; Body: UpdatePlanInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(PlanParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid plan ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdatePlanSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const plan = await billingService.updatePlan(paramsResult.data.id, bodyResult.data);
        return reply.status(200).send(formatPlanResponse(plan));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /billing/plans
   * List plans with pagination and filtering.
   */
  fastify.get(
    `${prefix}/plans`,
    async function listPlansHandler(
      request: FastifyRequest<{ Querystring: PlanListQuery }>,
      reply: FastifyReply,
    ) {
      const query = request.query as PlanListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;
      const sortBy = query.sortBy ?? 'sortOrder';
      const sortOrder = (query.sortOrder ?? 'asc') as 'asc' | 'desc';

      const result = await billingService.listPlans(
        {
          tier: query.tier,
          status: query.status,
          search: query.search,
        },
        { page, pageSize, sortBy, sortOrder },
      );

      return reply.status(200).send({
        data: result.data.map(formatPlanResponse),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /billing/plans/:id
   * Get a single plan by ID.
   */
  fastify.get(
    `${prefix}/plans/:id`,
    async function getPlanHandler(
      request: FastifyRequest<{ Params: PlanParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(PlanParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid plan ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const plan = await billingService.getPlanById(paramsResult.data.id);
        return reply.status(200).send(formatPlanResponse(plan));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Subscription Routes ───────────────────────────────────────────────

  /**
   * POST /billing/subscriptions
   * Subscribe a tenant to a plan.
   */
  fastify.post(
    `${prefix}/subscriptions`,
    async function createSubscriptionHandler(
      request: FastifyRequest<{ Body: CreateSubscriptionInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateSubscriptionSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      try {
        const subscription = await billingService.subscribeTenant(result.data);
        const plan = await billingService.getPlanById(subscription.planId);
        return reply
          .status(201)
          .send(billingService.formatSubscriptionResponse(subscription, plan.name));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /billing/subscriptions/:id
   * Get a subscription by ID.
   */
  fastify.get(
    `${prefix}/subscriptions/:id`,
    async function getSubscriptionHandler(
      request: FastifyRequest<{ Params: SubscriptionParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(SubscriptionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid subscription ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const subscription = await billingService.getSubscription(paramsResult.data.id);
        const plan = await billingService.getPlanById(subscription.planId);
        return reply
          .status(200)
          .send(billingService.formatSubscriptionResponse(subscription, plan.name));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /billing/subscriptions/:id/activate
   * Activate a trial subscription.
   */
  fastify.post(
    `${prefix}/subscriptions/:id/activate`,
    async function activateSubscriptionHandler(
      request: FastifyRequest<{ Params: SubscriptionParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(SubscriptionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid subscription ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const subscription = await billingService.activateSubscription(paramsResult.data.id);
        const plan = await billingService.getPlanById(subscription.planId);
        return reply
          .status(200)
          .send(billingService.formatSubscriptionResponse(subscription, plan.name));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /billing/subscriptions/:id/suspend
   * Suspend a subscription.
   */
  fastify.post(
    `${prefix}/subscriptions/:id/suspend`,
    async function suspendSubscriptionHandler(
      request: FastifyRequest<{ Params: SubscriptionParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(SubscriptionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid subscription ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const subscription = await billingService.suspendSubscription(paramsResult.data.id);
        const plan = await billingService.getPlanById(subscription.planId);
        return reply
          .status(200)
          .send(billingService.formatSubscriptionResponse(subscription, plan.name));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /billing/subscriptions/:id/cancel
   * Cancel a subscription.
   */
  fastify.post(
    `${prefix}/subscriptions/:id/cancel`,
    async function cancelSubscriptionHandler(
      request: FastifyRequest<{ Params: SubscriptionParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(SubscriptionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid subscription ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const subscription = await billingService.cancelSubscription(paramsResult.data.id);
        const plan = await billingService.getPlanById(subscription.planId);
        return reply
          .status(200)
          .send(billingService.formatSubscriptionResponse(subscription, plan.name));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /billing/subscriptions/:id/reactivate
   * Reactivate a suspended subscription.
   */
  fastify.post(
    `${prefix}/subscriptions/:id/reactivate`,
    async function reactivateSubscriptionHandler(
      request: FastifyRequest<{ Params: SubscriptionParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(SubscriptionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid subscription ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const subscription = await billingService.reactivateSubscription(paramsResult.data.id);
        const plan = await billingService.getPlanById(subscription.planId);
        return reply
          .status(200)
          .send(billingService.formatSubscriptionResponse(subscription, plan.name));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /billing/subscriptions/:id/upgrade
   * Upgrade a subscription's plan.
   */
  fastify.post(
    `${prefix}/subscriptions/:id/upgrade`,
    async function upgradeHandler(
      request: FastifyRequest<{ Params: SubscriptionParams; Body: ChangePlanInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(SubscriptionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid subscription ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(ChangePlanSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        // Get the subscription to find the tenant
        const existingSub = await billingService.getSubscription(paramsResult.data.id);
        const subscription = await billingService.upgradePlan(
          existingSub.tenantId,
          bodyResult.data,
        );
        const plan = await billingService.getPlanById(subscription.planId);
        return reply
          .status(200)
          .send(billingService.formatSubscriptionResponse(subscription, plan.name));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /billing/subscriptions/:id/downgrade
   * Downgrade a subscription's plan.
   */
  fastify.post(
    `${prefix}/subscriptions/:id/downgrade`,
    async function downgradeHandler(
      request: FastifyRequest<{ Params: SubscriptionParams; Body: ChangePlanInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(SubscriptionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid subscription ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(ChangePlanSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const existingSub = await billingService.getSubscription(paramsResult.data.id);
        const result = await billingService.downgradePlan(existingSub.tenantId, bodyResult.data);
        return reply.status(200).send(result);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Entitlement & Usage Routes ────────────────────────────────────────

  /**
   * POST /billing/entitlements/check
   * Check if a tenant is entitled to a feature.
   */
  fastify.post(
    `${prefix}/entitlements/check`,
    async function checkEntitlementHandler(
      request: FastifyRequest<{ Body: CheckEntitlementInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CheckEntitlementSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      try {
        const entitlement = await billingService.checkEntitlement(
          result.data.tenantId,
          result.data.feature,
        );
        return reply.status(200).send(entitlement);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /billing/usage/record
   * Record usage and enforce quota.
   */
  fastify.post(
    `${prefix}/usage/record`,
    async function recordUsageHandler(
      request: FastifyRequest<{ Body: RecordUsageInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(RecordUsageSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      try {
        const quotaResult = await billingService.enforceQuota(
          result.data.tenantId,
          result.data.metric,
          result.data.increment,
        );
        const statusCode = quotaResult.allowed ? 200 : 429;
        return reply.status(statusCode).send(quotaResult);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /billing/usage/query
   * Get usage for a tenant and metric.
   */
  fastify.post(
    `${prefix}/usage/query`,
    async function getUsageHandler(
      request: FastifyRequest<{ Body: GetUsageInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(GetUsageSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      try {
        const periodStart = result.data.periodStart ? new Date(result.data.periodStart) : undefined;
        const periodEnd = result.data.periodEnd ? new Date(result.data.periodEnd) : undefined;

        const usage = await billingService.getUsage(
          result.data.tenantId,
          result.data.metric,
          periodStart,
          periodEnd,
        );
        return reply.status(200).send(usage);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
