/**
 * Well-known durable job type constants for queue / outbox workers.
 * Kept in a leaf module so outbox builders can import without circular deps.
 */

/** Well-known job type for examination document generation workers (P0-06). */
export const EXAM_DOCUMENT_JOB_TYPE = 'exam.document.generate';

/** Consumer binding pattern for all tenants' exam document jobs. */
export const EXAM_DOCUMENT_CONSUME_TOPIC = 'tenant.*.exam.document.generate';

/** Well-known job type for workflow timeout escalations (P1-WF). */
export const WORKFLOW_ESCALATION_JOB_TYPE = 'workflow.escalation';

/** Consumer binding pattern for all tenants' workflow escalation jobs. */
export const WORKFLOW_ESCALATION_CONSUME_TOPIC = 'tenant.*.workflow.escalation';

/** Optional side-channel when an escalation transition notifies a role. */
export const WORKFLOW_ESCALATION_NOTIFY_TYPE = 'workflow.escalation.notified';

/** Well-known job type for notification delivery / retry workers (W2-JOB-01). */
export const NOTIFICATION_DELIVERY_JOB_TYPE = 'notification.delivery';

/** Consumer binding pattern for all tenants' notification delivery jobs. */
export const NOTIFICATION_DELIVERY_CONSUME_TOPIC = 'tenant.*.notification.delivery';

/** Well-known job type for assessment report-card generation workers (W2-JOB-02). */
export const REPORT_CARD_JOB_TYPE = 'report-card.generate';

/** Consumer binding pattern for all tenants' report-card generation jobs. */
export const REPORT_CARD_CONSUME_TOPIC = 'tenant.*.report-card.generate';

/** Well-known job type for student bulk import workers (W2-JOB-06). */
export const STUDENT_IMPORT_JOB_TYPE = 'student.import';

/** Consumer binding pattern for all tenants' student import jobs. */
export const STUDENT_IMPORT_CONSUME_TOPIC = 'tenant.*.student.import';

/** Well-known job type for developer-portal webhook HTTP delivery (W2-JOB-07). */
export const WEBHOOK_DELIVERY_JOB_TYPE = 'webhook.delivery';

/** Consumer binding pattern for all tenants' webhook delivery jobs. */
export const WEBHOOK_DELIVERY_CONSUME_TOPIC = 'tenant.*.webhook.delivery';
