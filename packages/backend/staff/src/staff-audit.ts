/**
 * PRC-M544: domain audit for staff/HR mutations — payroll run post/replace, contract
 * create/update, salary change, leave decision, offboarding and qualification verification.
 *
 * The sink is injected by the gateway (shared hash-chained audit log) and awaited after the
 * mutation, so a failed write surfaces as an error. Audit only: no payroll calculation changes.
 * No sink means no behaviour change.
 */
export interface StaffAuditEntry {
  tenantId: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export type StaffAuditSink = (entry: StaffAuditEntry) => Promise<void>;

export interface StaffAuditOptions {
  auditSink?: StaffAuditSink | null;
}

/** Emit one entry when a sink is configured. */
export async function emitStaffAudit(
  sink: StaffAuditSink | null | undefined,
  entry: StaffAuditEntry,
): Promise<void> {
  if (sink) await sink(entry);
}
