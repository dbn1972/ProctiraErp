/**
 * F2 — sandbox honesty for fee dunning / overdue reminders (G-709).
 * No live Twilio/SES claim until secrets exist.
 */

export const FEES_REMINDER_SANDBOX_HONESTY_NOTE =
  'Sandbox fee reminders — email/SMS sends are accepted and audited without calling Twilio/SES. Live delivery (G-709) is not claimed.';

/** PRC-L291: recorded when a configured provider (DR50) accepted the reminder. */
export const FEES_REMINDER_LIVE_HONESTY_NOTE =
  'Fee reminders handed to the messaging provider (MSG91 SMS / Amazon SES email). The audit records the provider message id; delivery to the handset or inbox is reported by the provider.';
export type ReminderChannel = 'email' | 'sms';
export type ReminderSendMode = 'sandbox' | 'live';
/** DR50: MSG91 sends SMS, Amazon SES sends email (db/sql/328 pins the pairing). */
export type ReminderProvider = 'msg91' | 'ses';
/**
 * PRC-L291: a live reminder sender. Without one, sends stay sandbox. An adapter
 * must return the provider's own message id; the database refuses a live audit
 * row without it.
 */
export interface ReminderDeliveryPort {
  send(input: {
    tenantId: string;
    invoiceId: string;
    studentId: string;
    channel: ReminderChannel;
    /** Stable per (tenant, invoice, channel, day); pass it to the provider as its idempotency key. */
    idempotencyKey: string;
  }): Promise<{ provider: ReminderProvider; providerMessageId: string }>;
}

export interface ReminderSuppressionEntity {
  id: string;
  tenantId: string;
  /** Suppress all reminders for this student when set. */
  studentId: string | null;
  /** Suppress reminders for a single invoice when set. */
  invoiceId: string | null;
  reason: string;
  createdBy: string;
  createdAt: Date;
}

export interface ReminderSendAuditEntity {
  id: string;
  tenantId: string;
  invoiceId: string;
  studentId: string;
  channel: ReminderChannel;
  messageId: string;
  mode: ReminderSendMode;
  /** PRC-L291: set on live rows only. */
  provider?: ReminderProvider | null;
  providerMessageId?: string | null;
  honestyNote: string;
  actorId: string;
  createdAt: Date;
}

export interface SendReminderResultRow {
  invoiceId: string;
  studentId: string;
  channel: ReminderChannel;
  messageId: string | null;
  suppressed: boolean;
  skippedReason?: string;
  auditId?: string;
}
