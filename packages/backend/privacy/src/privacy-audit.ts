/**
 * Optional audit sink for privacy lifecycle writes (W1-SEC-06).
 * Gateway wires AuditService; unit tests use RecordingPrivacyAuditPort.
 */
export interface PrivacyAuditEvent {
  tenantId: string;
  entityType: string;
  entityId: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  userId: string;
  userName: string;
  ipAddress?: string;
  beforeValues?: Record<string, unknown> | null;
  afterValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface PrivacyAuditPort {
  record(event: PrivacyAuditEvent): Promise<void>;
}

/** Test / default sink that retains events in-process. */
export class RecordingPrivacyAuditPort implements PrivacyAuditPort {
  readonly events: PrivacyAuditEvent[] = [];

  async record(event: PrivacyAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

/** No-op sink when audit is not wired. */
export class NoopPrivacyAuditPort implements PrivacyAuditPort {
  async record(_event: PrivacyAuditEvent): Promise<void> {
    // intentionally empty
  }
}
