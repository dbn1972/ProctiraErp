/**
 * Bulk Attendance Producer
 *
 * Publishes bulk attendance records to the queue instead of writing directly to DB.
 * This enables queue-first processing for large attendance submissions,
 * improving response times and allowing background processing with retries.
 *
 * The consumer (not in this file) reads from the 'attendance.bulk' topic
 * and persists records to the database in batches.
 */
import type { AttendanceStatus } from '@proctira/common';
import type { QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
import { buildTenantName } from '@proctira/queue-abstraction';

/**
 * A single attendance record within a bulk submission.
 */
export interface AttendanceRecord {
  studentId: string;
  institutionId: string;
  classId: string;
  academicPeriodId: string;
  date: string;
  subjectId?: string | null;
  periodId?: string | null;
  status: AttendanceStatus;
  comment?: string | null;
  recordedBy: string;
}

/**
 * Payload published to the attendance.bulk queue topic.
 */
export interface BulkAttendancePayload {
  jobId: string;
  tenantId: string;
  records: AttendanceRecord[];
  timestamp: string;
}

/**
 * Result returned to the caller after publishing.
 */
export interface BulkAttendanceJobRef {
  jobId: string;
  recordCount: number;
  topic: string;
}

export class BulkAttendanceProducer {
  constructor(private readonly queue: QueueAdapter) {}

  /**
   * Publishes bulk attendance records to the queue for async processing.
   *
   * @param tenantId - Tenant identifier for multi-tenant routing
   * @param records - Array of attendance records to process
   * @returns Job reference with the generated job ID
   */
  async publishBulkAttendance(
    tenantId: string,
    records: AttendanceRecord[],
  ): Promise<BulkAttendanceJobRef> {
    const jobId = crypto.randomUUID();
    const topic = buildTenantName(tenantId, 'attendance.bulk');

    const message: QueueMessage<BulkAttendancePayload> = {
      id: crypto.randomUUID(),
      tenantId,
      type: 'attendance.bulk',
      payload: {
        jobId,
        tenantId,
        records,
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    };

    await this.queue.dispatch(message, { topic });

    return {
      jobId,
      recordCount: records.length,
      topic,
    };
  }
}
