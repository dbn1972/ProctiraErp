/**
 * PRC-M629 (DR47): plugin event handlers receive ids and non-personal
 * attributes only; names, contact details, PHI and financial details never
 * reach them, and a filter cannot probe a personal field.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { minimiseEventData } from './event-minimisation.js';
import { ExtensionPointRegistry } from './extension-point-registry.js';
import type { DomainEventPayload } from './types.js';

const fullEvent: DomainEventPayload = {
  eventType: 'student.created',
  tenantId: 'tenant-1',
  entityId: 'student-123',
  entityType: 'student',
  actorId: 'user-1',
  timestamp: new Date(),
  correlationId: 'corr-1',
  data: {
    institutionId: 'inst-abc',
    guardianIds: ['g-1', 'g-2'],
    status: 'active',
    changedFields: ['firstName', 'phone'],
    firstName: 'Asha',
    email: 'asha@example.com',
    phone: '+919800000000',
    address: { line1: '12 MG Road' },
    diagnosis: 'asthma',
    feeBalance: 2500,
    notes: 'free text',
  },
};

describe('PRC-M629 minimiseEventData', () => {
  it('keeps ids and allow-listed attributes only', () => {
    expect(minimiseEventData(fullEvent.data)).toEqual({
      institutionId: 'inst-abc',
      guardianIds: ['g-1', 'g-2'],
      status: 'active',
      changedFields: ['firstName', 'phone'],
    });
  });
});

describe('PRC-M629 dispatchEvent hands minimised data to plugins', () => {
  let registry: ExtensionPointRegistry;

  beforeEach(() => {
    registry = new ExtensionPointRegistry();
    registry.registerEventDefinition({
      eventType: 'student.created',
      name: 'Student Created',
      description: 'Fired when a student is created',
      version: '1.0.0',
      stability: 'stable',
      requiredPermissions: ['student.read'],
      payloadSchema: { type: 'object' },
      entityType: 'student',
    });
  });

  it('the handler never sees personal fields', async () => {
    let received: DomainEventPayload | null = null;
    registry.subscribeToEvent({
      eventType: 'student.created',
      pluginId: 'plugin-1',
      pluginInstallId: 'install-1',
      tenantId: 'tenant-1',
      handler: async (event) => {
        received = event;
      },
      pluginPermissions: ['student.read'],
    });
    await registry.dispatchEvent(fullEvent);
    expect(received).not.toBeNull();
    const seen = received as unknown as DomainEventPayload;
    expect(seen.entityId).toBe('student-123');
    expect(seen.data).toEqual({
      institutionId: 'inst-abc',
      guardianIds: ['g-1', 'g-2'],
      status: 'active',
      changedFields: ['firstName', 'phone'],
    });
    const serialized = JSON.stringify(seen);
    for (const secret of ['Asha', 'asha@example.com', '+919800000000', 'MG Road', 'asthma']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('a filter on a personal field never matches', async () => {
    let invoked = false;
    registry.subscribeToEvent({
      eventType: 'student.created',
      pluginId: 'plugin-1',
      pluginInstallId: 'install-1',
      tenantId: 'tenant-1',
      handler: async () => {
        invoked = true;
      },
      filter: { email: 'asha@example.com' },
      pluginPermissions: ['student.read'],
    });
    await registry.dispatchEvent(fullEvent);
    expect(invoked).toBe(false);
  });
});
