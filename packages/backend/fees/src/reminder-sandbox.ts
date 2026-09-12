/**
 * F2 — sandbox honesty for fee dunning / overdue reminders (G-709).
 * No live Twilio/SES claim until secrets exist.
 */

export const FEES_REMINDER_SANDBOX_HONESTY_NOTE =
  'Sandbox fee reminders — email/SMS sends are accepted and audited without calling Twilio/SES. Live delivery (G-709) is not claimed.';

export type ReminderChannel = 'email' | 'sms';

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
  mode: 'sandbox';
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
