/**
 * Communication service — campaigns and dual-confirm emergency blasts.
 * G-604: sandbox delivery adapter + optional audit sink on send/dispatch.
 */
import { ConflictError, NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import { estimateAudience } from './audience.js';
import type { CommunicationRepository } from './communication-repository.js';
import {
  createSandboxDeliveryAdapter,
  type CommunicationDeliveryAdapter,
  type DeliveryResult,
} from './delivery-adapter.js';
import { fetchLiveAudienceCounts } from './live-audience.js';
import type { CreateCampaignInput, CreateEmergencyBlastInput } from './schemas.js';

export interface CommunicationAuditEvent {
  action: 'campaign.send' | 'emergency.dispatch';
  tenantId: string;
  resourceId: string;
  delivery: DeliveryResult;
  at: Date;
}

export type CommunicationAuditSink = (event: CommunicationAuditEvent) => void | Promise<void>;

export class CommunicationService {
  private readonly deliveryAdapter: CommunicationDeliveryAdapter;
  private readonly auditSink: CommunicationAuditSink | null;
  /** In-process audit trail for unit tests / honesty when gateway audit is separate. */
  readonly localAuditLog: CommunicationAuditEvent[] = [];

  constructor(
    private readonly repository: CommunicationRepository,
    options: {
      deliveryAdapter?: CommunicationDeliveryAdapter;
      auditSink?: CommunicationAuditSink | null;
    } = {},
  ) {
    this.deliveryAdapter = options.deliveryAdapter ?? createSandboxDeliveryAdapter();
    this.auditSink = options.auditSink ?? null;
  }

  async previewAudience(tenantId: string, audienceJson: Record<string, unknown> = {}) {
    const live = await fetchLiveAudienceCounts(tenantId, audienceJson);
    return estimateAudience(audienceJson, live);
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
   * Sandbox send via delivery adapter — transitions draft/scheduled → sent.
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

    const estimatedRecipients = estimateAudience(campaign.audienceJson).estimatedRecipients;
    const delivery = await this.deliveryAdapter.deliver({
      tenantId,
      channels: campaign.channels,
      body: campaign.body,
      subject: campaign.name,
      estimatedRecipients,
    });

    const updated = await this.repository.updateCampaign(id, tenantId, {
      status: 'sent',
      sentAt: new Date(),
    });

    await this.recordAudit({
      action: 'campaign.send',
      tenantId,
      resourceId: id,
      delivery,
      at: new Date(),
    });

    return {
      campaign: updated!,
      delivery: {
        ...delivery,
        estimatedRecipients,
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

  /**
   * Sandbox dispatch for a fully confirmed emergency blast via delivery adapter.
   */
  async dispatchEmergencyBlast(tenantId: string, id: string) {
    const blast = await this.repository.findEmergencyBlastById(id, tenantId);
    if (!blast) {
      throw new NotFoundError(`Emergency blast with id '${id}' not found`);
    }
    if (blast.status === 'sent') {
      throw new ConflictError('Emergency blast is already marked sent');
    }
    if (blast.status !== 'confirmed') {
      throw new ConflictError('Emergency blast must be dual-confirmed before dispatch');
    }

    const delivery = await this.deliveryAdapter.deliver({
      tenantId,
      channels: blast.channels,
      reason: blast.reason,
    });

    const updated = await this.repository.updateEmergencyBlast(id, tenantId, {
      status: 'sent',
    });

    await this.recordAudit({
      action: 'emergency.dispatch',
      tenantId,
      resourceId: id,
      delivery,
      at: new Date(),
    });

    return {
      blast: updated!,
      delivery,
    };
  }

  private async recordAudit(event: CommunicationAuditEvent) {
    this.localAuditLog.push(event);
    if (this.auditSink) {
      await this.auditSink(event);
    }
  }
}
