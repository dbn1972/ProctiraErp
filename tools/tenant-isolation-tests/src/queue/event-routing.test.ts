/**
 * Category 4 — Queue/event routing isolation tests.
 *
 * Drives the *real* tenant-prefix builders exported from `@proctira/events`
 * (Kafka topics, RabbitMQ queues, RabbitMQ routing keys) and the generic
 * `buildTenantName` helper from `@proctira/queue-abstraction`. A bug in any
 * of those builders that drops or swaps the tenant id will surface here.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 * Validates: Requirements 4.7, 24.2 (event tenant prefix), 24.3 (queue tenant prefix)
 */

import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import {
  buildTenantTopic,
  buildTenantQueue,
  buildTenantRoutingKey,
} from '@proctira/events';

import {
  aggregateTypeArb,
  assertContainsTenant,
  assertNoForeignTenantInString,
  distinctTenantPairArb,
  taskTypeArb,
  uuidV4Arb,
} from '../helpers/index.js';

describe('Category 4 — Queue / Event Routing Isolation', () => {
  describe('Kafka topics', () => {
    it('topic format follows tenant.{tenantId}.{aggregate}', () => {
      fc.assert(
        fc.property(uuidV4Arb, aggregateTypeArb, (tenantId, aggregate) => {
          const topic = buildTenantTopic(tenantId, aggregate);
          expect(topic).toBe(`tenant.${tenantId}.${aggregate}`);
          assertContainsTenant('queue:kafka:topic', tenantId, topic);
        }),
        { numRuns: 100 },
      );
    });

    it('distinct tenants produce distinct topics for the same aggregate', () => {
      fc.assert(
        fc.property(distinctTenantPairArb, aggregateTypeArb, ({ tenantA, tenantB }, aggregate) => {
          const topicA = buildTenantTopic(tenantA, aggregate);
          const topicB = buildTenantTopic(tenantB, aggregate);

          expect(topicA).not.toBe(topicB);
          assertNoForeignTenantInString('queue:kafka:topic', tenantA, topicA, [tenantB]);
          assertNoForeignTenantInString('queue:kafka:topic', tenantB, topicB, [tenantA]);
        }),
        { numRuns: 100 },
      );
    });

    it('a consumer subscribed to tenant A never matches a tenant B publication', () => {
      fc.assert(
        fc.property(distinctTenantPairArb, aggregateTypeArb, ({ tenantA, tenantB }, aggregate) => {
          const subscribed = buildTenantTopic(tenantA, aggregate);
          const published = buildTenantTopic(tenantB, aggregate);
          expect(subscribed).not.toBe(published);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('RabbitMQ queues', () => {
    it('queue format follows tenant.{tenantId}.{taskType}', () => {
      fc.assert(
        fc.property(uuidV4Arb, taskTypeArb, (tenantId, taskType) => {
          const queue = buildTenantQueue(tenantId, taskType);
          expect(queue).toBe(`tenant.${tenantId}.${taskType}`);
          assertContainsTenant('queue:rabbitmq:queue', tenantId, queue);
        }),
        { numRuns: 100 },
      );
    });

    it('distinct tenants produce distinct queue names', () => {
      fc.assert(
        fc.property(distinctTenantPairArb, taskTypeArb, ({ tenantA, tenantB }, taskType) => {
          const qa = buildTenantQueue(tenantA, taskType);
          const qb = buildTenantQueue(tenantB, taskType);
          expect(qa).not.toBe(qb);
          assertNoForeignTenantInString('queue:rabbitmq:queue', tenantA, qa, [tenantB]);
          assertNoForeignTenantInString('queue:rabbitmq:queue', tenantB, qb, [tenantA]);
        }),
        { numRuns: 100 },
      );
    });

    it('routing keys are tenant-scoped — no cross-tenant message delivery', () => {
      fc.assert(
        fc.property(distinctTenantPairArb, taskTypeArb, ({ tenantA, tenantB }, key) => {
          const ka = buildTenantRoutingKey(tenantA, key);
          const kb = buildTenantRoutingKey(tenantB, key);

          expect(ka).toBe(`tenant.${tenantA}.${key}`);
          expect(kb).toBe(`tenant.${tenantB}.${key}`);
          expect(ka).not.toBe(kb);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Task message routing', () => {
    /**
     * Simulates the publisher: a task message MUST always be routed to a
     * queue/key that contains its own tenant id.
     */
    function publish(task: { id: string; tenantId: string; type: string }): {
      queue: string;
      routingKey: string;
    } {
      return {
        queue: buildTenantQueue(task.tenantId, task.type),
        routingKey: buildTenantRoutingKey(task.tenantId, task.type),
      };
    }

    it('a task message can never be routed to another tenant`s queue', () => {
      fc.assert(
        fc.property(distinctTenantPairArb, taskTypeArb, ({ tenantA, tenantB }, taskType) => {
          const fromA = publish({ id: 'task-a', tenantId: tenantA, type: taskType });
          const fromB = publish({ id: 'task-b', tenantId: tenantB, type: taskType });

          assertNoForeignTenantInString('queue:routing', tenantA, fromA.queue, [tenantB]);
          assertNoForeignTenantInString('queue:routing', tenantA, fromA.routingKey, [tenantB]);
          assertNoForeignTenantInString('queue:routing', tenantB, fromB.queue, [tenantA]);
          assertNoForeignTenantInString('queue:routing', tenantB, fromB.routingKey, [tenantA]);
        }),
        { numRuns: 100 },
      );
    });

    it('subscriber routing pattern only matches its own tenant`s tasks', () => {
      fc.assert(
        fc.property(distinctTenantPairArb, taskTypeArb, ({ tenantA, tenantB }, taskType) => {
          // The subscriber binds to its own tenant queue with its own routing key.
          const subQueueA = buildTenantQueue(tenantA, taskType);
          const subKeyA = buildTenantRoutingKey(tenantA, taskType);

          // Tenant B publishes the same logical task type.
          const pubKeyB = buildTenantRoutingKey(tenantB, taskType);

          // RabbitMQ exchange-binding semantics: routing keys must match the
          // queue's bound key. Different routing keys ⇒ no delivery.
          expect(pubKeyB).not.toBe(subKeyA);
          expect(subQueueA.startsWith(`tenant.${tenantA}.`)).toBe(true);
          expect(pubKeyB.startsWith(`tenant.${tenantB}.`)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });
});
