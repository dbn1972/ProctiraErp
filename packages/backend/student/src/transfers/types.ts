import type { TransferDecision, TransferWorkflowStatus } from './state-machine.js';

export interface TransferWorkflowRow {
  id: string;
  tenantId: string;
  studentId: string;
  studentName: string | null;
  currentGradeName: string | null;
  sourceInstitutionId: string;
  sourceInstitutionName: string | null;
  sourceBoardId: string | null;
  sourceBoardName: string | null;
  sourceBoardCode: string | null;
  sourceEnrollmentId: string;
  destinationInstitutionId: string;
  destinationInstitutionName: string | null;
  destinationBoardId: string | null;
  destinationBoardName: string | null;
  destinationBoardCode: string | null;
  destinationEnrollmentId: string | null;
  destinationGradeId: string;
  destinationClassId: string;
  academicPeriodId: string;
  transferDate: string;
  reason: string;
  status: TransferWorkflowStatus;
  requestedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransferApprovalEvent {
  id: string;
  transferId: string;
  fromStatus: TransferWorkflowStatus;
  toStatus: TransferWorkflowStatus;
  decision: TransferDecision | 'COMMENT';
  actorUserId: string;
  actorRole: string;
  actorName: string;
  comment: string | null;
  createdAt: string;
}

export interface GradeEquivalencyRule {
  id: string;
  tenantId: string;
  sourceBoardId: string;
  sourceBoardCode: string | null;
  sourceBoardName: string | null;
  targetBoardId: string;
  targetBoardCode: string | null;
  targetBoardName: string | null;
  sourceGradeCode: string;
  targetGradeCode: string;
  sourceSubject: string;
  targetSubject: string;
  sourceMarksMax: number;
  targetMarksMax: number;
  creditFactor: number;
  mappingStatus: 'mapped' | 'bridge' | 'na';
  notes: string | null;
}

export interface CreateTransferInput {
  studentId: string;
  sourceEnrollmentId: string;
  sourceInstitutionId: string;
  destinationInstitutionId: string;
  destinationGradeId: string;
  destinationClassId: string;
  academicPeriodId: string;
  reason: string;
  transferDate: string;
  /** Optional board ids for the in-memory store. Postgres loads them from institutions. */
  sourceBoardId?: string;
  destinationBoardId?: string;
  sourceBoardCode?: string;
  destinationBoardCode?: string;
  studentName?: string;
  sourceInstitutionName?: string;
  destinationInstitutionName?: string;
}

export interface EquivalencyInput {
  sourceBoardId: string;
  targetBoardId: string;
  sourceGradeCode: string;
  targetGradeCode: string;
  sourceSubject: string;
  targetSubject: string;
  sourceMarksMax: number;
  targetMarksMax: number;
  creditFactor: number;
  mappingStatus: 'mapped' | 'bridge' | 'na';
  notes?: string;
}
