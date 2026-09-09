/**
 * G-922 circulars, acknowledgements, delivery log, WhatsApp sandbox send.
 */
import { randomUUID } from 'node:crypto';

import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@proctira/common';

import type { CreateCircularInput } from './circular-schemas.js';
import type {
  CircularAckRecord,
  CircularRecord,
  CircularStore,
  DeliveryLogFilter,
  DeliveryLogRecord,
} from './circular-store.js';
import {
  createSandboxWhatsAppAdapter,
  type WhatsAppChannelAdapter,
} from './whatsapp-adapter.js';

export interface CircularView extends CircularRecord {
  ackTotal: number;
  ackCount: number;
  ackRate: number;
  acks: CircularAckRecord[];
}

function ackRate(total: number, count: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 1000) / 1000;
}

export class CircularsService {
  private readonly whatsapp: WhatsAppChannelAdapter;

  constructor(
    private readonly store: CircularStore,
    options: { whatsappAdapter?: WhatsAppChannelAdapter } = {},
  ) {
    this.whatsapp = options.whatsappAdapter ?? createSandboxWhatsAppAdapter();
  }

  async createCircular(tenantId: string, input: CreateCircularInput): Promise<CircularView> {
    if (input.requiresAck && (!input.recipientIds || input.recipientIds.length === 0)) {
      throw new ValidationError('requiresAck circulars need at least one recipientId');
    }
    const now = new Date();
    const record = await this.store.createCircular({
      id: randomUUID(),
      tenantId,
      title: input.title,
      body: input.body,
      audienceType: input.audienceType,
      audienceJson: {
        type: input.audienceType,
        ids: input.audienceIds ?? [],
        recipientIds: input.recipientIds ?? [],
      },
      requiresAck: input.requiresAck ?? false,
      channels: input.channels && input.channels.length > 0 ? input.channels : ['in_app'],
      status: 'draft',
      createdBy: input.createdBy ?? null,
      sentAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const labels = input.recipientLabels ?? {};
    for (const recipientId of input.recipientIds ?? []) {
      await this.store.createAck({
        id: randomUUID(),
        tenantId,
        circularId: record.id,
        recipientId,
        recipientLabel: labels[recipientId] ?? null,
        acknowledgedAt: null,
        createdAt: now,
      });
    }

    return this.toView(tenantId, record);
  }

  async listCirculars(tenantId: string): Promise<CircularView[]> {
    const rows = await this.store.listCirculars(tenantId);
    const views: CircularView[] = [];
    for (const row of rows) {
      views.push(await this.toView(tenantId, row));
    }
    return views;
  }

  async getCircular(tenantId: string, id: string): Promise<CircularView> {
    const row = await this.store.findCircular(tenantId, id);
    if (!row) throw new NotFoundError(`Circular with id '${id}' not found`);
    return this.toView(tenantId, row);
  }

  async sendCircular(tenantId: string, id: string): Promise<CircularView> {
    const circular = await this.getCircular(tenantId, id);
    if (circular.status === 'sent') {
      throw new ConflictError('Circular is already marked sent');
    }

    const recipients = circular.acks.length
      ? circular.acks.map((ack) => ({
          id: ack.recipientId,
          label: ack.recipientLabel,
        }))
      : [{ id: 'audience', label: circular.audienceType }];

    const now = new Date();
    for (const recipient of recipients) {
      for (const channel of circular.channels) {
        await this.deliverOne(tenantId, {
          channel,
          recipientId: recipient.id,
          recipientLabel: recipient.label,
          sourceType: 'circular',
          sourceId: circular.id,
          title: circular.title,
          body: circular.body,
          at: now,
        });
      }
    }

    const updated = await this.store.updateCircular(tenantId, id, {
      status: 'sent',
      sentAt: now,
    });
    console.info(
      JSON.stringify({
        msg: 'communication.circular.send',
        tenantId,
        circularId: id,
        recipients: recipients.length,
        channels: circular.channels,
      }),
    );
    return this.toView(tenantId, updated!);
  }

  async ackCircular(
    tenantId: string,
    circularId: string,
    recipientId: string,
  ): Promise<CircularView> {
    const circular = await this.getCircular(tenantId, circularId);
    if (!circular.requiresAck) {
      throw new BusinessRuleError('This circular does not require acknowledgement');
    }
    const ack = await this.store.findAck(tenantId, circularId, recipientId);
    if (!ack) {
      throw new NotFoundError(`Recipient '${recipientId}' is not on this circular`);
    }
    if (ack.acknowledgedAt) {
      return circular;
    }
    await this.store.updateAck(tenantId, ack.id, { acknowledgedAt: new Date() });
    return this.getCircular(tenantId, circularId);
  }

  async listDeliveryLogs(
    tenantId: string,
    filter: DeliveryLogFilter = {},
  ): Promise<DeliveryLogRecord[]> {
    return this.store.listDeliveryLogs(tenantId, filter);
  }

  async retryFailed(tenantId: string, logId: string): Promise<DeliveryLogRecord> {
    const row = await this.store.findDeliveryLog(tenantId, logId);
    if (!row) throw new NotFoundError(`Delivery log '${logId}' not found`);
    if (row.status !== 'failed') {
      throw new ConflictError('Only failed deliveries can be retried');
    }

    const now = new Date();
    if (row.channel === 'whatsapp') {
      const result = await this.whatsapp.send({
        tenantId,
        recipientId: row.recipientId,
        recipientLabel: row.recipientLabel ?? undefined,
        body: '',
        sourceType: row.sourceType,
        sourceId: row.sourceId ?? logId,
      });
      const updated = await this.store.updateDeliveryLog(tenantId, logId, {
        status: 'sent',
        providerRef: result.providerRef,
        errorMessage: null,
        sentAt: now,
        retriedAt: now,
      });
      return updated!;
    }

    const updated = await this.store.updateDeliveryLog(tenantId, logId, {
      status: 'sent',
      providerRef: `sandbox-retry:${logId}`,
      errorMessage: null,
      sentAt: now,
      retriedAt: now,
    });
    return updated!;
  }

  async appendSourceDelivery(
    tenantId: string,
    args: {
      channels: string[];
      sourceType: 'campaign' | 'emergency';
      sourceId: string;
      title?: string;
      body?: string;
    },
  ): Promise<void> {
    const now = new Date();
    for (const channel of args.channels.length > 0 ? args.channels : ['in_app']) {
      await this.deliverOne(tenantId, {
        channel,
        recipientId: 'audience',
        recipientLabel: args.sourceType,
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        title: args.title,
        body: args.body ?? '',
        at: now,
      });
    }
  }

  private async deliverOne(
    tenantId: string,
    args: {
      channel: string;
      recipientId: string;
      recipientLabel: string | null;
      sourceType: 'campaign' | 'emergency' | 'circular';
      sourceId: string;
      title?: string;
      body: string;
      at: Date;
    },
  ): Promise<DeliveryLogRecord> {
    const channel = args.channel.toLowerCase();
    if (channel === 'whatsapp') {
      const result = await this.whatsapp.send({
        tenantId,
        recipientId: args.recipientId,
        recipientLabel: args.recipientLabel ?? undefined,
        title: args.title,
        body: args.body,
        sourceType: args.sourceType,
        sourceId: args.sourceId,
      });
      return this.store.createDeliveryLog({
        id: randomUUID(),
        tenantId,
        channel: 'whatsapp',
        recipientId: args.recipientId,
        recipientLabel: args.recipientLabel,
        status: 'sent',
        providerRef: result.providerRef,
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        errorMessage: null,
        queuedAt: args.at,
        sentAt: args.at,
        deliveredAt: null,
        failedAt: null,
        retriedAt: null,
        createdAt: args.at,
        updatedAt: args.at,
      });
    }

    return this.store.createDeliveryLog({
      id: randomUUID(),
      tenantId,
      channel,
      recipientId: args.recipientId,
      recipientLabel: args.recipientLabel,
      status: 'sent',
      providerRef: `sandbox:${channel}:${args.sourceId}`,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      errorMessage: null,
      queuedAt: args.at,
      sentAt: args.at,
      deliveredAt: null,
      failedAt: null,
      retriedAt: null,
      createdAt: args.at,
      updatedAt: args.at,
    });
  }

  private async toView(tenantId: string, record: CircularRecord): Promise<CircularView> {
    const acks = await this.store.listAcks(tenantId, record.id);
    const ackCount = acks.filter((row) => row.acknowledgedAt != null).length;
    return {
      ...record,
      acks,
      ackTotal: acks.length,
      ackCount,
      ackRate: ackRate(acks.length, ackCount),
    };
  }
}
