/**
 * W2-JOB-09: scheduled report recipient delivery port.
 *
 * Catalogue schedules store recipient emails/addresses but historically only
 * generated artifacts. Delivery is an injectable port so the gateway can wire
 * notification/email without coupling the report package to those backends.
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

export interface ScheduleDeliveryPort {
  deliver(request: ScheduleDeliveryRequest): Promise<void>;
}

/** Records deliveries for tests / local demos (no network I/O). */
export class InMemoryScheduleDelivery implements ScheduleDeliveryPort {
  readonly sent: ScheduleDeliveryRequest[] = [];

  async deliver(request: ScheduleDeliveryRequest): Promise<void> {
    if (request.recipients.length === 0) return;
    this.sent.push({
      ...request,
      recipients: [...request.recipients],
    });
  }
}

/** No-op port used when no delivery backend is configured. */
export class NoopScheduleDelivery implements ScheduleDeliveryPort {
  async deliver(_request: ScheduleDeliveryRequest): Promise<void> {
    // Intentionally empty — callers still generate the artifact.
  }
}
