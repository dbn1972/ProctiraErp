/**
 * Helpers to build outbox entries for well-known job types.
 */
import { randomUUID } from 'node:crypto';

import { EXAM_DOCUMENT_JOB_TYPE, WORKFLOW_ESCALATION_JOB_TYPE } from '../job-types.js';

import type { NewOutboxEntry } from './types.js';

export interface ExamDocumentOutboxInput {
  tenantId: string;
  jobId: string;
  examinationId: string;
  documentType: string;
}

export function buildExamDocumentOutboxEntry(input: ExamDocumentOutboxInput): NewOutboxEntry {
  return {
    id: randomUUID(),
    tenantId: input.tenantId,
    aggregateType: 'examination_document_job',
    aggregateId: input.jobId,
    eventType: EXAM_DOCUMENT_JOB_TYPE,
    payload: {
      jobId: input.jobId,
      examinationId: input.examinationId,
      documentType: input.documentType,
    },
    metadata: {
      correlationId: input.jobId,
      maxRetries: 3,
    },
    dispatchMode: 'dispatch',
  };
}

export interface WorkflowEscalationOutboxInput {
  tenantId: string;
  taskId: string;
  payload: unknown;
  delayMs?: number;
}

export function buildWorkflowEscalationOutboxEntry(
  input: WorkflowEscalationOutboxInput,
): NewOutboxEntry {
  return {
    id: randomUUID(),
    tenantId: input.tenantId,
    aggregateType: 'workflow_escalation',
    aggregateId: input.taskId,
    eventType: WORKFLOW_ESCALATION_JOB_TYPE,
    payload: input.payload,
    metadata: {
      correlationId: input.taskId,
      delay: input.delayMs,
    },
    dispatchMode: 'dispatch',
  };
}
