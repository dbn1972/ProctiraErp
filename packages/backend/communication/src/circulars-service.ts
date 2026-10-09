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
  /** PRC-L287: hard cap for the in-process audit fallback ring buffer. */
  static readonly MAX_LOCAL_AUDIT_ENTRIES = 1000;
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

    const now = new Date();
    // PRC-M502: atomically claim the draft BEFORE fanning out deliveries. A
    // concurrent send loses the compare-and-set and is rejected, so recipients
    // are never double-delivered by two racing requests.
    const claimed = await this.store.claimCircularForSend(tenantId, id, now);
    if (!claimed) {
      throw new ConflictError('Circular is already being sent or has been sent');
    }

    const recipients = circular.acks.length
      ? circular.acks.map((ack) => ({
          id: ack.recipientId,
          label: ack.recipientLabel,
        }))
      : [{ id: 'audience', label: circular.audienceType }];

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
    return this.toView(tenantId, claimed);
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
    // PRC-L287: the in-process trail is a bounded ring buffer so a process with
    // no durable audit sink wired cannot grow memory without limit. The durable
    // sink (when set) is the system of record; this is only a local fallback.
    this.localAuditLog.push(event);
    if (this.localAuditLog.length > CircularsService.MAX_LOCAL_AUDIT_ENTRIES) {
      this.localAuditLog.splice(
        0,
        this.localAuditLog.length - CircularsService.MAX_LOCAL_AUDIT_ENTRIES,
      );
    }
  }

  async listDeliveryLogs(
    tenantId: string,
    filter: DeliveryLogFilter = {},
    page: PageRequest = DEFAULT_PAGE,
  ): Promise<Page<DeliveryLogRecord>> {
    return toPage(await this.store.listDeliveryLogs(tenantId, filter, page), page);
  }

  /**
   * PRC-M189 / PRC-L088: retry re-delivers through the SAME channel adapter path
   * as the original send (never fabricates a `sent` status with a made-up
   * providerRef, and never resends an empty WhatsApp body).
   *
   * The original message content is recovered from its source record so the
   * retried delivery carries the real title/body. If the source content cannot
   * be recovered (e.g. the circular was deleted, or a campaign/emergency body is
   * not retrievable in this slice), the retry FAILS CLOSED — the row stays
   * `failed` with an explanatory error rather than being marked sent with no
   * content.
   */
  async retryFailed(tenantId: string, logId: string): Promise<DeliveryLogRecord> {
    const row = await this.store.findDeliveryLog(tenantId, logId);
    if (!row) throw new NotFoundError(`Delivery log '${logId}' not found`);
    if (row.status !== 'failed') {
      throw new ConflictError('Only failed deliveries can be retried');
    }

    const content = await this.resolveSourceContent(tenantId, row);
    const now = new Date();
    if (!content) {
      // Fail closed: do not mark sent without recoverable content (PRC-L088).
      await this.store.updateDeliveryLog(tenantId, logId, {
        status: 'failed',
        errorMessage:
          'Retry could not recover the original message content; delivery not re-attempted',
        failedAt: now,
        retriedAt: now,
      });
      throw new BusinessRuleError(
        'Original message content for this delivery is no longer available; cannot retry',
      );
    }

    if (row.channel === 'whatsapp') {
      const result = await this.whatsapp.send({
        tenantId,
        recipientId: row.recipientId,
        recipientLabel: row.recipientLabel ?? undefined,
        title: content.title,
        body: content.body,
        sourceType: row.sourceType,
        sourceId: row.sourceId ?? logId,
      });
      const updated = await this.store.updateDeliveryLog(tenantId, logId, {
        status: result.status === 'sent' ? 'sent' : 'failed',
        providerRef: result.providerRef,
        errorMessage: result.status === 'sent' ? null : result.honestyNote,
        sentAt: result.status === 'sent' ? now : null,
        failedAt: result.status === 'sent' ? null : now,
        retriedAt: now,
      });
      return updated!;
    }

    // Non-WhatsApp sandbox channel: use the same self-labelled `sandbox:` ref
    // shape as the original delivery so the log never fabricates provider
    // acceptance it did not receive.
    const updated = await this.store.updateDeliveryLog(tenantId, logId, {
      status: 'sent',
      providerRef: `sandbox:${row.channel}:${row.sourceId ?? logId}`,
      errorMessage: null,
      sentAt: now,
      retriedAt: now,
    });
    return updated!;
  }

  /**
   * Recover the original title/body for a failed delivery so a retry can resend
   * the real content. Only circular sources can be recovered in this slice;
   * campaign/emergency bodies are not persisted on the log, so they return null
   * and the retry fails closed (never sends an empty body).
   */
  private async resolveSourceContent(
    tenantId: string,
    row: DeliveryLogRecord,
  ): Promise<{ title?: string; body: string } | null> {
    if (row.sourceType === 'circular' && row.sourceId) {
      const circular = await this.store.findCircular(tenantId, row.sourceId);
      if (!circular) return null;
      return { title: circular.title, body: circular.body };
    }
    return null;
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
