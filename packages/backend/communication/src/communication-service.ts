/**
 * Communication service — campaigns and dual-confirm emergency blasts.
 */
import { ConflictError, NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { CommunicationRepository } from './communication-repository.js';
import type { CreateCampaignInput, CreateEmergencyBlastInput } from './schemas.js';

export class CommunicationService {
  constructor(private readonly repository: CommunicationRepository) {}

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
