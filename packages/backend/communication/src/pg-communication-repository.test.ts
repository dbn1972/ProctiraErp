/**
 * Unit smoke for Pg communication repository against live DATABASE_URL (skipped otherwise).
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { isPgCommunicationEnabled } from './create-communication-repository.js';
import {
  getSharedCommunicationPool,
  PgCommunicationRepository,
} from './pg-communication-repository.js';

describe('PgCommunicationRepository', () => {
  it.skipIf(!isPgCommunicationEnabled())('creates and lists a campaign', async () => {
    const pool = getSharedCommunicationPool();
    expect(pool).not.toBeNull();
    const repo = new PgCommunicationRepository(pool!);
    const tenantId = randomUUID();
    const campaignId = randomUUID();

    await repo.createCampaign({
      id: campaignId,
      tenantId,
      name: 'Pg unit campaign',
      status: 'draft',
      channels: ['email', 'in_app'],
      body: 'Hello',
      audienceJson: { scope: 'all' },
      scheduledAt: null,
      sentAt: null,
      createdBy: 'local-dev-user',
    });

    const listed = await repo.listCampaigns(tenantId);
    expect(listed.some((c) => c.id === campaignId)).toBe(true);
    expect(listed.find((c) => c.id === campaignId)?.createdBy).toBe('local-dev-user');
  });

  it.skipIf(!isPgCommunicationEnabled())('dual-confirms an emergency blast', async () => {
    const pool = getSharedCommunicationPool();
    const repo = new PgCommunicationRepository(pool!);
    const tenantId = randomUUID();
    const blastId = randomUUID();

    await repo.createEmergencyBlast({
      id: blastId,
      tenantId,
      reason: 'Drill',
      channels: ['sms'],
      status: 'pending_confirm',
      confirmActor1: null,
      confirmActor2: null,
      confirmedAt: null,
      createdBy: 'officer-a',
    });

    await repo.updateEmergencyBlast(blastId, tenantId, { confirmActor1: 'actor-1' });
    const confirmed = await repo.updateEmergencyBlast(blastId, tenantId, {
      confirmActor2: 'actor-2',
      status: 'confirmed',
      confirmedAt: new Date(),
    });

    expect(confirmed?.status).toBe('confirmed');
    expect(confirmed?.confirmActor1).toBe('actor-1');
    expect(confirmed?.confirmActor2).toBe('actor-2');
  });
});
