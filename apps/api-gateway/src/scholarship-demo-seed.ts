/**
 * Demo seed for the gateway's in-memory scholarship repository.
 */
import type {
  DisbursementEntity,
  ScholarshipApplicationEntity,
  ScholarshipProgramEntity,
  ScholarshipRepository,
} from '@proctira/backend-scholarship';

const TENANT_ID = '00000000-0000-4000-8000-0000000000aa';

export async function seedScholarshipDemoData(
  repository: ScholarshipRepository,
): Promise<void> {
  const now = new Date();
  const programId = '11111111-1111-4111-8111-111111111111';
  const applicationId = '22222222-2222-4222-8222-222222222222';
  const disbursementId = '33333333-3333-4333-8333-333333333333';
  const applicantId = '44444444-4444-4444-8444-444444444444';
  const institutionId = '55555555-5555-4555-8555-555555555555';

  const program: Omit<ScholarshipProgramEntity, 'createdAt' | 'updatedAt'> = {
    id: programId,
    tenantId: TENANT_ID,
    name: 'National Merit Scholarship 2026',
    description: 'Code: NMS-2026\nMerit-based award for Class X–XII students.',
    applicationStartDate: '2026-01-01',
    applicationEndDate: '2026-06-30',
    totalSlots: 100,
    usedSlots: 1,
    amountPerRecipient: 25000,
    currency: 'INR',
    disbursementFrequency: 'one_time',
    eligibility: { minGPA: 3.0 },
    status: 'open',
    academicPeriodId: null,
    fundingSourceId: null,
  };
  await repository.createProgram(program);

  const application: Omit<ScholarshipApplicationEntity, 'createdAt' | 'updatedAt'> = {
    id: applicationId,
    tenantId: TENANT_ID,
    programId,
    applicantId,
    institutionId,
    status: 'under_review',
    academicRecords: [
      {
        institutionName: 'Demo Higher Secondary School',
        educationLevel: 'secondary',
        gpa: 3.6,
        yearCompleted: 2025,
      },
    ],
    financialInfo: {
      familyIncome: 180000,
      numberOfDependents: 3,
      employmentStatus: 'student',
    },
    documents: [],
    personalStatement: 'Aspiring STEM student seeking merit support.',
    areaId: null,
    gender: 'female',
    workflowInstanceId: null,
    submittedAt: now,
    reviewedAt: null,
  };
  await repository.createApplication(application);

  const disbursement: Omit<DisbursementEntity, 'createdAt' | 'updatedAt'> = {
    id: disbursementId,
    tenantId: TENANT_ID,
    applicationId,
    amount: 25000,
    scheduledDate: '2026-07-15',
    paidDate: null,
    paymentStatus: 'scheduled',
    paymentMethod: 'bank_transfer',
    transactionReference: null,
    notes: 'Demo DBT batch',
  };
  await repository.createDisbursement(disbursement);
}
