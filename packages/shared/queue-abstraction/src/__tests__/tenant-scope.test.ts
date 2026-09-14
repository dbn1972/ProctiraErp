/**
 * W1-SEC-11 — queue subscribe/consume reject unscoped topics.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  InMemoryDurableQueueAdapter,
  InMemoryDurableQueueStore,
  assertTenantScopedSubscribeTopic,
  isTenantScopedQueueName,
  shouldRequireTenantScopedQueueTopics,
  TenantScopeError,
} from '../index';

describe('W1-SEC-11 queue tenant namespaces', () => {
  describe('isTenantScopedQueueName', () => {
    it('accepts scoped topics and tenant wildcards', () => {
      expect(isTenantScopedQueueName('tenant.acme.events')).toBe(true);
      expect(isTenantScopedQueueName('tenant.*.exam.document.generate')).toBe(true);
      expect(isTenantScopedQueueName('tenant.#')).toBe(true);
    });

    it('rejects unscoped names', () => {
      for (const name of ['events', 'student.enrolled', 'tenant.', 'tenant..x', '', '#', '*', 'global']) {
        expect(isTenantScopedQueueName(name)).toBe(false);
      }
    });
  });

  describe('assertTenantScopedSubscribeTopic', () => {
    it('rejects unscoped topics by default', () => {
      expect(() => assertTenantScopedSubscribeTopic('events')).toThrow(TenantScopeError);
      expect(() => assertTenantScopedSubscribeTopic('#')).toThrow(TenantScopeError);
    });

    it('allows scoped topics', () => {
      expect(() =>
        assertTenantScopedSubscribeTopic('tenant.acme.student.enrolled'),
      ).not.toThrow();
      expect(() =>
        assertTenantScopedSubscribeTopic('tenant.*.exam.document.generate'),
      ).not.toThrow();
    });

    it('honors emergency escape hatch', () => {
      expect(
        shouldRequireTenantScopedQueueTopics({
          NODE_ENV: 'production',
          ALLOW_UNSCOPED_TENANT_NAMESPACES: '1',
        }),
      ).toBe(false);
      expect(() =>
        assertTenantScopedSubscribeTopic('events', {
          env: { NODE_ENV: 'production', ALLOW_UNSCOPED_TENANT_NAMESPACES: '1' },
        }),
      ).not.toThrow();
    });

    it('fails closed in production by default', () => {
      expect(shouldRequireTenantScopedQueueTopics({ NODE_ENV: 'production' })).toBe(true);
      expect(() =>
        assertTenantScopedSubscribeTopic('events', { env: { NODE_ENV: 'production' } }),
      ).toThrow(TenantScopeError);
    });
  });

  describe('InMemoryDurableQueueAdapter subscribe reject path', () => {
    let adapter: InMemoryDurableQueueAdapter;

    beforeEach(async () => {
      adapter = new InMemoryDurableQueueAdapter({
        store: new InMemoryDurableQueueStore(),
        pollIntervalMs: 50,
      });
      await adapter.connect();
    });

    afterEach(async () => {
      if (adapter.isConnected()) await adapter.disconnect();
    });

    it('rejects unscoped consume topics', async () => {
      await expect(adapter.consume({ topic: 'events' }, async () => {})).rejects.toThrow(
        TenantScopeError,
      );
      await expect(adapter.subscribe({ topic: '#' }, async () => {})).rejects.toThrow(
        TenantScopeError,
      );
    });

    it('accepts tenant-scoped consume topics', async () => {
      await expect(
        adapter.consume({ topic: 'tenant.*.exam.document.generate' }, async () => {}),
      ).resolves.toBeUndefined();
    });
  });
});
