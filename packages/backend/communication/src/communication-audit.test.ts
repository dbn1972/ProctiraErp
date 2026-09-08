/**
 * Communication send audit + delivery adapter (G-604) unit tests.
 */
import { describe, expect, it } from 'vitest';

import { CommunicationService } from './communication-service.js';
import { createSandboxDeliveryAdapter } from './delivery-adapter.js';
import { InMemoryCommunicationRepository } from './in-memory-repository.js';

const TENANT = '550e8400-e29b-41d4-a716-446655440000';

describe('CommunicationService audit + adapter (G-604)', () => {
  it('records local audit on sandbox campaign send', async () => {
    const audits: string[] = [];
    const service = new CommunicationService(new InMemoryCommunicationRepository(), {
      deliveryAdapter: createSandboxDeliveryAdapter(),
      auditSink: (event) => {
        audits.push(event.action);
      },
    });

    const campaign = await service.createCampaign(TENANT, {
      name: 'Audit me',
      channels: ['email'],
      body: 'Hi',
    });
    const result = await service.sendCampaign(TENANT, campaign.id);

    expect(result.delivery.mode).toBe('sandbox');
    expect(service.localAuditLog).toHaveLength(1);
    expect(service.localAuditLog[0]!.action).toBe('campaign.send');
    expect(audits).toEqual(['campaign.send']);
  });

  it('records audit on emergency dispatch after dual confirm', async () => {
    const service = new CommunicationService(new InMemoryCommunicationRepository());
    const blast = await service.createEmergencyBlast(TENANT, {
      reason: 'Fire drill',
      channels: ['sms'],
    });
    await service.confirmEmergencyBlast(TENANT, blast.id, 'actor-1');
    await service.confirmEmergencyBlast(TENANT, blast.id, 'actor-2');
    const result = await service.dispatchEmergencyBlast(TENANT, blast.id);

    expect(result.delivery.mode).toBe('sandbox');
    expect(service.localAuditLog.some((e) => e.action === 'emergency.dispatch')).toBe(true);
  });
});
