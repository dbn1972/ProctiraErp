/**
 * Communication service — campaigns and dual-confirm emergency blasts.
 */
import { ConflictError, NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { CommunicationRepository } from './communication-repository.js';
import type { CreateCampaignInput, CreateEmergencyBlastInput } from './schemas.js';
import { estimateAudience } from './audience.js';

export class CommunicationService {
  constructor(private readonly repository: CommunicationRepository) {}

  previewAudience(audienceJson: Record<string, unknown> = {}) {
    return estimateAudience(audienceJson);
  }
  async createCampaign(tenantId: string, input: CreateCampaignInput) {
    return this.repository.createCampaign({
      id: uuidv4(),
      tenantId,
      name: input.name,
      status: 'draft',
      channels: input.channels ?? [],
      body: input.body ?? '',
      audienceJson: input.audienceJson ?? {},
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      sentAt: null,
      createdBy: input.createdBy ?? null,
    });
  }

  async listCampaigns(tenantId: string) {
    return this.repository.listCampaigns(tenantId);
  }

  async getCampaign(tenantId: string, id: string) {
    const campaign = await this.repository.findCampaignById(id, tenantId);
    if (!campaign) {
      throw new NotFoundError(`Campaign with id '${id}' not found`);
    }
    return campaign;
  }

  /**
   * Sandbox send: transitions draft/scheduled → sent without calling live providers.
   * Returns honesty metadata for UI banners until Twilio/FCM/SMTP secrets exist.
   */
  async sendCampaign(tenantId: string, id: string) {
    const campaign = await this.getCampaign(tenantId, id);
    if (campaign.status === 'sent') {
      throw new ConflictError('Campaign is already marked sent');
    }
    if (campaign.status === 'sending') {
      throw new ConflictError('Campaign send is already in progress');
    }
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      throw new ConflictError(`Cannot send campaign in status '${campaign.status}'`);
    }

    const updated = await this.repository.updateCampaign(id, tenantId, {
      status: 'sent',
      sentAt: new Date(),
    });

    return {
      campaign: updated!,
      delivery: {
        mode: 'sandbox' as const,
        honestyNote:
          'Sandbox send — status marked sent without calling SMS/email/push providers. Wire adapter credentials for production delivery.',
        estimatedRecipients: estimateAudience(campaign.audienceJson).estimatedRecipients,
      },
    };
  }

  async createEmergencyBlast(tenantId: string, input: CreateEmergencyBlastInput) {
    return this.repository.createEmergencyBlast({
      id: uuidv4(),
      tenantId,
      reason: input.reason,
      channels: input.channels,
      status: 'pending_confirm',
      confirmActor1: null,
      confirmActor2: null,
      confirmedAt: null,
      createdBy: input.createdBy ?? null,
    });
  }

  async listEmergencyBlasts(tenantId: string) {
    return this.repository.listEmergencyBlasts(tenantId);
  }

  async confirmEmergencyBlast(tenantId: string, id: string, actorId: string) {
    const blast = await this.repository.findEmergencyBlastById(id, tenantId);
    if (!blast) {
      throw new NotFoundError(`Emergency blast with id '${id}' not found`);
    }

    if (blast.status !== 'pending_confirm' && blast.status !== 'confirmed') {
      throw new ConflictError('Emergency blast is no longer awaiting confirmation');
    }

    if (!blast.confirmActor1) {
      return this.repository.updateEmergencyBlast(id, tenantId, { confirmActor1: actorId });
    }

    if (blast.confirmActor1 === actorId) {
      throw new ConflictError('Same actor cannot confirm twice');
    }

    if (blast.confirmActor2) {
      throw new ConflictError('Emergency blast is already fully confirmed');
    }

    const updated = await this.repository.updateEmergencyBlast(id, tenantId, {
      confirmActor2: actorId,
      status: 'confirmed',
      confirmedAt: new Date(),
    });

    return updated!;
  }
}
