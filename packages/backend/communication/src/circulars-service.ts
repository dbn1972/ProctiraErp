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
import { DEFAULT_PAGE, toPage, type Page, type PageRequest } from './pagination.js';
import { createWhatsAppAdapter, type WhatsAppChannelAdapter } from './whatsapp-adapter.js';

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

/**
 * Audit event for a staff-recorded (proxy) circular acknowledgement. Same
 * sink + in-process log pattern as `CommunicationAuditEvent` (G-604).
 */
export interface CircularAuditEvent {
  action: 'circular.ack_on_behalf';
  tenantId: string;
  /** Circular id. */
  resourceId: string;
  /** Staff member (session subject) who recorded the acknowledgement. */
  actorId: string;
  recipientId: string;
  reason: string;
  at: Date;
}
export type CircularAuditSink = (event: CircularAuditEvent) => void | Promise<void>;

export class CircularsService {
  private readonly whatsapp: WhatsAppChannelAdapter;
  private readonly auditSink: CircularAuditSink | null;
  /** In-process audit trail (unit tests / honesty when no durable sink is wired). */
  readonly localAuditLog: CircularAuditEvent[] = [];

  constructor(
    private readonly store: CircularStore,
    options: {
      whatsappAdapter?: WhatsAppChannelAdapter;
      auditSink?: CircularAuditSink | null;
    } = {},
  ) {
    // W1-ARCH-08: default via policy factory — never silent createSandboxWhatsAppAdapter().
    this.whatsapp = options.whatsappAdapter ?? createWhatsAppAdapter();
    this.auditSink = options.auditSink ?? null;
  }

  async createCircular(tenantId: string, input: CreateCircularInput): Promise<CircularView> {
    if (input.requiresAck && (!input.recipientIds || input.recipientIds.length === 0)) {
      throw new ValidationError('requiresAck circulars need at least one recipientId');
    }
    const now = new Date();
    // PRC-M193: de-duplicate recipients; circular + acks commit in one transaction.
    const recipientIds = [...new Set(input.recipientIds ?? [])];
    const labels = input.recipientLabels ?? {};
    const circularId = randomUUID();
    const record = await this.store.createCircularWithAcks(
      {
        id: circularId,
        tenantId,
        title: input.title,
        body: input.body,
        audienceType: input.audienceType,
        audienceJson: {
          type: input.audienceType,
          ids: input.audienceIds ?? [],
          recipientIds,
        },
        requiresAck: input.requiresAck ?? false,
        channels: input.channels && input.channels.length > 0 ? input.channels : ['in_app'],
        status: 'draft',
        createdBy: input.createdBy ?? null,
        sentAt: null,
        createdAt: now,
        updatedAt: now,
      },
      recipientIds.map((recipientId) => ({
        id: randomUUID(),
        tenantId,
        circularId,
        recipientId,
        recipientLabel: labels[recipientId] ?? null,
        acknowledgedAt: null,
        createdAt: now,
      })),
    );

    return this.toView(tenantId, record);
  }

  /**
   * PRC-M191: paginated; ack totals come from ONE grouped query and the
   * per-recipient ack rows are only returned by GET :id.
   */
  async listCirculars(
    tenantId: string,
    page: PageRequest = DEFAULT_PAGE,
  ): Promise<Page<CircularView>> {
    const { data: rows, nextCursor } = toPage(await this.store.listCirculars(tenantId, page), page);
    const counts = await this.store.countAcksByCircular(
      tenantId,
      rows.map((r) => r.id),
    );
    const data = rows.map((record) => {
      const c = counts.get(record.id) ?? { total: 0, acknowledged: 0 };
      return {
        ...record,
        acks: [],
        ackTotal: c.total,
        ackCount: c.acknowledged,
        ackRate: ackRate(c.total, c.acknowledged),
      };
    });
    return { data, nextCursor };
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
    // eslint-disable-next-line no-console
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
      // PRC-M188: uniform message — never echo the probed recipient id.
      throw new NotFoundError('No acknowledgement is pending for you on this circular');
    }
    if (ack.acknowledgedAt) {
      return circular;
    }
    await this.store.updateAck(tenantId, ack.id, { acknowledgedAt: new Date() });
    return this.getCircular(tenantId, circularId);
  }

  /**
   * Owner decision (PR #548): an admin records an acknowledgement on behalf of
   * a recipient. Authorization (admin-only) is enforced by the route; this
   * method requires a non-empty reason and writes the audit entry BEFORE the
   * ack is stored, so no proxy acknowledgement can exist without its audit
   * row (a failing durable sink fails the request and records nothing).
   * Re-recording an already acknowledged recipient is a no-op (no audit).
   */
  async ackCircularOnBehalf(
    tenantId: string,
    circularId: string,
    recipientId: string,
    by: { actorId: string; reason: string },
  ): Promise<CircularView> {
    const reason = by.reason.trim();
    if (!reason) {
      throw new ValidationError('A reason is required to record an acknowledgement on behalf', [
        { field: 'reason', rule: 'required', message: 'Reason is required' },
      ]);
    }
    if (!by.actorId) throw new ValidationError('Acting staff member is required');
    const circular = await this.getCircular(tenantId, circularId);
    if (!circular.requiresAck) {
      throw new BusinessRuleError('This circular does not require acknowledgement');
    }
    const ack = await this.store.findAck(tenantId, circularId, recipientId);
    if (!ack) {
      throw new NotFoundError('No acknowledgement is pending for that recipient on this circular');
    }
    if (ack.acknowledgedAt) return circular;
    const at = new Date();
    await this.recordAudit({
      action: 'circular.ack_on_behalf',
      tenantId,
      resourceId: circularId,
      actorId: by.actorId,
      recipientId,
      reason,
      at,
    });
    await this.store.updateAck(tenantId, ack.id, { acknowledgedAt: at });
    return this.getCircular(tenantId, circularId);
  }

  private async recordAudit(event: CircularAuditEvent): Promise<void> {
    if (this.auditSink) await this.auditSink(event);
    this.localAuditLog.push(event);
  }

  async listDeliveryLogs(
    tenantId: string,
    filter: DeliveryLogFilter = {},
    page: PageRequest = DEFAULT_PAGE,
  ): Promise<Page<DeliveryLogRecord>> {
    return toPage(await this.store.listDeliveryLogs(tenantId, filter, page), page);
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
