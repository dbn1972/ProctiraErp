/**
 * Durable queue publishers for privacy anonymization + tenant offboard (W1-SEC-06).
 */
import { randomUUID } from 'node:crypto';

import type { QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
import {
  PRIVACY_ANONYMIZATION_JOB_TYPE,
  PRIVACY_TENANT_OFFBOARD_JOB_TYPE,
} from '@proctira/queue-abstraction';

export interface PrivacyAnonymizationJobPayload {
  jobId: string;
  tenantId: string;
  erasureRequestId: string;
}

export interface PrivacyTenantOffboardJobPayload {
  jobId: string;
  tenantId: string;
}

export interface PrivacyAnonymizationPublisher {
  enqueueAnonymization(payload: PrivacyAnonymizationJobPayload): Promise<void>;
}

export interface PrivacyOffboardPublisher {
  enqueueOffboard(payload: PrivacyTenantOffboardJobPayload): Promise<void>;
}

export class QueuePrivacyAnonymizationPublisher implements PrivacyAnonymizationPublisher {
  constructor(private readonly queue: QueueAdapter) {}

  async enqueueAnonymization(payload: PrivacyAnonymizationJobPayload): Promise<void> {
    const message: QueueMessage<PrivacyAnonymizationJobPayload> = {
      id: randomUUID(),
      tenantId: payload.tenantId,
      type: PRIVACY_ANONYMIZATION_JOB_TYPE,
      payload,
      timestamp: new Date().toISOString(),
      metadata: { correlationId: payload.erasureRequestId },
    };
    await this.queue.dispatch(message);
  }
}

export class QueuePrivacyOffboardPublisher implements PrivacyOffboardPublisher {
  constructor(private readonly queue: QueueAdapter) {}

  async enqueueOffboard(payload: PrivacyTenantOffboardJobPayload): Promise<void> {
    const message: QueueMessage<PrivacyTenantOffboardJobPayload> = {
      id: randomUUID(),
      tenantId: payload.tenantId,
      type: PRIVACY_TENANT_OFFBOARD_JOB_TYPE,
      payload,
      timestamp: new Date().toISOString(),
      metadata: { correlationId: payload.jobId },
    };
    await this.queue.dispatch(message);
  }
}
