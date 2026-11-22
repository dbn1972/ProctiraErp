/**
 * W2-JOB-09: scheduled report recipient delivery port.
 *
 * Catalogue schedules store recipient emails/addresses but historically only
 * generated artifacts. Delivery is an injectable port so the gateway can wire
 * notification/email without coupling the report package to those backends.
 *
 * PRC-M338: the plugin used to fall back to the in-memory port and the scheduler
 * counted every call as "delivered" although nothing left the process. A port now
 * returns a {@link ScheduleDeliveryOutcome}; only `status: 'delivered'` counts.
 */
export interface ScheduleDeliveryRequest {
  tenantId: string;
  scheduleId: string;
  reportKey: string;
  recipients: string[];
  downloadUrl: string;
  artifactId: string;
  runId: string;
}

/**
 * What a delivery attempt achieved.
 * - `delivered`: a live channel accepted the message for every recipient;
 * - `not_delivered`: nothing was sent (no backend configured, or a sandbox channel).
 * A port signals a failed send by throwing.
 */
export interface ScheduleDeliveryOutcome {
  status: 'delivered' | 'not_delivered';
  recipients: number;
  reason?: string;
}

export interface ScheduleDeliveryPort {
  /** `void` is accepted for older ports and is treated as `not_delivered`. */
  deliver(request: ScheduleDeliveryRequest): Promise<ScheduleDeliveryOutcome | void>;
}

/** Records deliveries for tests / local demos (no network I/O). */
export class InMemoryScheduleDelivery implements ScheduleDeliveryPort {
  readonly sent: ScheduleDeliveryRequest[] = [];
  async deliver(request: ScheduleDeliveryRequest): Promise<ScheduleDeliveryOutcome> {
    if (request.recipients.length === 0) {
      return { status: 'not_delivered', recipients: 0, reason: 'no recipients' };
    }
    this.sent.push({
      ...request,
      recipients: [...request.recipients],
    });
    return {
      status: 'not_delivered',
      recipients: request.recipients.length,
      reason: 'in-memory delivery (nothing sent)',
    };
  }
}

/** No-op port used when no delivery backend is configured. */
export class NoopScheduleDelivery implements ScheduleDeliveryPort {
  async deliver(request: ScheduleDeliveryRequest): Promise<ScheduleDeliveryOutcome> {
    // Intentionally empty — callers still generate the artifact.
    return {
      status: 'not_delivered',
      recipients: request.recipients.length,
      reason: 'no delivery backend configured',
    };
  }
}

/**
 * Structural copy of the notification service's `EmailSender` port
 * (packages/backend/notification/src/notification-service.ts). Declared here so the
 * report package does not take a package dependency on the notification package; the
 * gateway passes the notification email sender in.
 */
export interface ScheduleEmailSender {
  send(params: { to: string; subject: string; body: string; tenantId: string }): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
    mode?: 'sandbox' | 'live';
    honestyNote?: string;
  }>;
}

export class ScheduleDeliveryError extends Error {
  constructor(
    message: string,
    readonly failures: Array<{ recipient: string; error: string }>,
  ) {
    super(message);
    this.name = 'ScheduleDeliveryError';
  }
}

export interface EmailScheduleDeliveryOptions {
  /** Absolute origin of the web app, used to turn the artifact path into a link. */
  appBaseUrl?: string;
}

/**
 * PRC-M338: delivers a scheduled report notice through the notification email port.
 *
 * The email carries the report key and a link to the artifact path WITHOUT the
 * short-lived download token: opening it requires a signed-in session, so a mailbox
 * never holds a bearer link to the export (PRC-L338 / PRC-L341 stay tracked separately).
 * A send that fails for any recipient throws, so the scheduler retries instead of
 * advancing; a sandbox email sender is reported as `not_delivered`.
 */
export class EmailScheduleDelivery implements ScheduleDeliveryPort {
  constructor(
    private readonly sender: ScheduleEmailSender,
    private readonly options: EmailScheduleDeliveryOptions = {},
  ) {}

  async deliver(request: ScheduleDeliveryRequest): Promise<ScheduleDeliveryOutcome> {
    const recipients = [...new Set(request.recipients.map((r) => r.trim()).filter(Boolean))];
    if (recipients.length === 0) {
      return { status: 'not_delivered', recipients: 0, reason: 'no recipients' };
    }
    const link = this.artifactLink(request.artifactId);
    const subject = `Scheduled report ready: ${request.reportKey}`;
    const body = [
      `Your scheduled report "${request.reportKey}" has been generated.`,
      '',
      `Sign in to download it: ${link}`,
      '',
      `Run: ${request.runId}`,
    ].join('\n');

    const failures: Array<{ recipient: string; error: string }> = [];
    let live = 0;
    for (const to of recipients) {
      try {
        const result = await this.sender.send({ to, subject, body, tenantId: request.tenantId });
        if (!result.success) {
          failures.push({ recipient: to, error: result.error ?? 'send failed' });
        } else if (result.mode !== 'sandbox') {
          live += 1;
        }
      } catch (err) {
        failures.push({ recipient: to, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (failures.length > 0) {
      throw new ScheduleDeliveryError(
        `Scheduled report delivery failed for ${failures.length} of ${recipients.length} recipient(s)`,
        failures,
      );
    }
    if (live < recipients.length) {
      return {
        status: 'not_delivered',
        recipients: recipients.length,
        reason: 'email sender is in sandbox mode (no live provider configured)',
      };
    }
    return { status: 'delivered', recipients: recipients.length };
  }

  private artifactLink(artifactId: string): string {
    const path = `/api/v1/reports/artifacts/${encodeURIComponent(artifactId)}/download`;
    const base = this.options.appBaseUrl?.trim().replace(/\/+$/, '');
    return base ? `${base}${path}` : path;
  }
}
