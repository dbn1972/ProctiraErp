/**
 * @proctira/backend-fees — fee plans, invoices, sandbox payments, receipts.
 *
 * Persists to parent_fee_* (db/sql/010 + 011) via raw pg + withPgTenant when
 * DATABASE_URL is set; otherwise in-memory. Mounted on api-gateway at `/fees`.
 */

export { feesPlugin } from './fees-plugin.js';
export type { FeesPluginOptions, ParentFeeBinding } from './fees-plugin.js';

export {
  FeesService,
  parseReconciliationCsv,
  FEES_REMINDER_SANDBOX_HONESTY_NOTE,
} from './fees-service.js';
export type {
  CreateFeePlanInput,
  CreateInvoiceInput,
  RecordPaymentInput,
  CreateFeeStructureInput,
  GenerateInstalmentScheduleInput,
  BulkInvoiceInput,
  ApplyConcessionInput,
  RecordRefundInput,
  ReminderChannel,
  ReminderSendAuditEntity,
  ReminderSuppressionEntity,
  AddReminderSuppressionInput,
  SendRemindersInput,
} from './fees-service.js';
export type {
  FeePlanEntity,
  FeeInvoiceEntity,
  FeePaymentEntity,
  FeeReceiptEntity,
  FeesRepository,
  FeePlanFrequency,
  FeePlanStatus,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  FeeLedgerEntryEntity,
  LedgerAccount,
  LedgerSide,
  LedgerTrialBalance,
  FeeStructureEntity,
  FeeStructureInstalmentEntity,
  FeeConcessionEntity,
  FeeRefundEntity,
} from './fees-repository.js';
export { UnbalancedJournalError, assertJournalBalanced } from './fees-repository.js';

export {
  allocateInstalments,
  allocateByShares,
  concessionDiscountCents,
  remainingRefundableCents,
  assertRefundWithinPaid,
} from './instalment-schedule.js';

export { InMemoryFeesRepository } from './in-memory-repository.js';

export {
  createFeesRepository,
  isPgFeesEnabled,
  resetSharedFeesRepositoryForTests,
} from './create-fees-repository.js';
export {
  PgFeesRepository,
  createPgFeesRepository,
  getSharedFeesPool,
  ensureFeesSchema,
} from './pg-fees-repository.js';

export { SandboxPaymentAdapter } from './payment-adapter.js';
export type { PaymentAdapter, ChargeInput, ChargeResult } from './payment-adapter.js';
