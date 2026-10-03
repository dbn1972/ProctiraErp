/**
 * Communication service — campaigns and dual-confirm emergency blasts.
 * G-604: sandbox delivery adapter + optional audit sink on send/dispatch.
 */
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import { estimateAudience } from './audience.js';
import type { CommunicationRepository } from './communication-repository.js';
import {
  createSandboxDeliveryAdapter,
  type CommunicationDeliveryAdapter,
  type DeliveryResult,
} from './delivery-adapter.js';
import { fetchLiveAudienceCounts } from './live-audience.js';
import { DEFAULT_PAGE, toPage, type PageRequest } from './pagination.js';
import {
  MAX_AUDIENCE_JSON_BYTES,
  type CreateCampaignInput,
  type CreateEmergencyBlastInput,
} from './schemas.js';

export interface CommunicationAuditEvent {
  action: 'campaign.send' | 'emergency.dispatch';
  tenantId: string;
  resourceId: string;
  delivery: DeliveryResult;
  at: Date;
}

export type CommunicationAuditSink = (event: CommunicationAuditEvent) => void | Promise<void>;

export interface CommunicationDeliveryLogSink {
  (event: {
    tenantId: string;
    channels: string[];
    sourceType: 'campaign' | 'emergency';
    sourceId: string;
    title?: string;
    body?: string;
  }): void | Promise<void>;
}

export class CommunicationService {
  private readonly deliveryAdapter: CommunicationDeliveryAdapter;
  private readonly auditSink: CommunicationAuditSink | null;
  private readonly deliveryLogSink: CommunicationDeliveryLogSink | null;
  /** In-process audit trail for unit tests / honesty when gateway audit is separate. */
  readonly localAuditLog: CommunicationAuditEvent[] = [];

  constructor(
    private readonly repository: CommunicationRepository,
    options: {
      deliveryAdapter?: CommunicationDeliveryAdapter;
      auditSink?: CommunicationAuditSink | null;
      deliveryLogSink?: CommunicationDeliveryLogSink | null;
    } = {},
  ) {
    this.deliveryAdapter = options.deliveryAdapter ?? createSandboxDeliveryAdapter();
    this.auditSink = options.auditSink ?? null;
    this.deliveryLogSink = options.deliveryLogSink ?? null;
  }

  async previewAudience(tenantId: string, audienceJson: Record<string, unknown> = {}) {
    const live = await fetchLiveAudienceCounts(tenantId, audienceJson);
    return estimateAudience(audienceJson, live);
  }

  async createCampaign(tenantId: string, input: CreateCampaignInput, actorId: string | null) {
    if (
      input.audienceJson &&
      Buffer.byteLength(JSON.stringify(input.audienceJson), 'utf8') > MAX_AUDIENCE_JSON_BYTES
    ) {
      throw new ValidationError(`audienceJson exceeds ${MAX_AUDIENCE_JSON_BYTES} bytes`);
    }
    if (input.scheduledAt !== undefined) {
      const at = Date.parse(input.scheduledAt);
      if (Number.isNaN(at)) throw new ValidationError('scheduledAt must be an ISO date-time');
      if (at <= Date.now()) throw new ValidationError('scheduledAt must be in the future');
      // PRC-M192: no scheduler transitions 'scheduled' campaigns, so accepting a
      // schedule would silently never send. Fail closed until one exists.
      throw new BusinessRuleError(
        'Scheduled sending is not available; create a draft and send it explicitly',
      );
    }
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
      // PRC-H045: attribution comes from the verified session, not client input.
      createdBy: actorId,
    });
  }

  async listCampaigns(tenantId: string, page: PageRequest = DEFAULT_PAGE) {
    return toPage(await this.repository.listCampaigns(tenantId, page), page);
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

    if (this.deliveryLogSink) {
      await this.deliveryLogSink({
        tenantId,
        channels: campaign.channels,
        sourceType: 'campaign',
        sourceId: id,
        title: campaign.name,
        body: campaign.body,
      });
    }

    return {
      campaign: updated!,
      delivery: {
        ...delivery,
        estimatedRecipients,
      },
    };
  }

  async createEmergencyBlast(
    tenantId: string,
    input: CreateEmergencyBlastInput,
    actorId: string | null,
  ) {
    return this.repository.createEmergencyBlast({
      id: uuidv4(),
      tenantId,
      reason: input.reason,
      channels: input.channels,
      status: 'pending_confirm',
      confirmActor1: null,
      confirmActor2: null,
      confirmedAt: null,
      // PRC-H045: creator recorded from the verified session, not client input.
      createdBy: actorId,
    });
  }

  async listEmergencyBlasts(tenantId: string, page: PageRequest = DEFAULT_PAGE) {
    return toPage(await this.repository.listEmergencyBlasts(tenantId, page), page);
  }

  async confirmEmergencyBlast(tenantId: string, id: string, actorId: string) {
    const blast = await this.repository.findEmergencyBlastById(id, tenantId);
    if (!blast) {
      throw new NotFoundError(`Emergency blast with id '${id}' not found`);
    }

    if (blast.status !== 'pending_confirm' && blast.status !== 'confirmed') {
      throw new ConflictError('Emergency blast is no longer awaiting confirmation');
    }

    // PRC-H045: two-person control. The creator may not be one of the two confirmers, otherwise
    // the person who raised the blast could self-approve one half of the dual confirmation.
    if (blast.createdBy && blast.createdBy === actorId) {
      throw new ConflictError('The creator of an emergency blast cannot confirm it');
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

    if (this.deliveryLogSink) {
      await this.deliveryLogSink({
        tenantId,
        channels: blast.channels,
        sourceType: 'emergency',
        sourceId: id,
        body: blast.reason,
      });
    }

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
