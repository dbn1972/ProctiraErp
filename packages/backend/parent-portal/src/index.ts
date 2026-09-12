/**
 * @proctira/backend-parent-portal — child links, messaging, consents, fees, academic reads.
 */

export { parentPortalPlugin } from './parent-portal-plugin.js';
export type { ParentPortalPluginOptions } from './parent-portal-plugin.js';

export { ParentPortalService } from './parent-portal-service.js';
export type { StudentActor } from './parent-portal-service.js';
export type { FeesLedgerPort } from './parent-portal-service.js';

export type {
  ParentChildLinkEntity,
  MessageThreadEntity,
  MessageEntity,
  ConsentEntity,
  FeeInvoiceEntity,
  FeePaymentEntity,
  ParentPortalRepository,
} from './parent-portal-repository.js';

export type { AdmissionsOffersPort, ParentAdmissionOffer } from './admissions-offers-port.js';

export { InMemoryParentPortalRepository } from './in-memory-repository.js';

export {
  createParentPortalRepository,
  createAcademicVisibilityStore,
  isPgParentPortalEnabled,
} from './create-parent-portal-repository.js';
export {
  PgParentPortalRepository,
  createPgParentPortalRepository,
  getSharedParentPortalPool,
  ensureParentPortalSchema,
  ensureParentPortalSeed,
} from './pg-parent-portal-repository.js';

export {
  EmptyAcademicVisibilityStore,
  STUDENT_SELF_BINDING_ASSUMPTION,
  UUID_RE,
  summariseAttendance,
} from './academic-visibility.js';
export type {
  AcademicVisibilityStore,
  AcademicList,
  AttendancePayload,
  GradesPayload,
} from './academic-visibility.js';
export { PgAcademicVisibilityStore } from './pg-academic-visibility-store.js';

export {
  LinkChildSchema,
  CreateThreadSchema,
  ThreadParamsSchema,
  AddMessageSchema,
  CreateConsentSchema,
  ConsentParamsSchema,
  DecideConsentSchema,
  CreateInvoiceSchema,
  InvoiceParamsSchema,
  PayInvoiceSchema,
  StudentQuerySchema,
  ChildParamsSchema,
} from './schemas.js';
export type {
  LinkChildInput,
  CreateThreadInput,
  ThreadParams,
  AddMessageInput,
  CreateConsentInput,
  ConsentParams,
  DecideConsentInput,
  CreateInvoiceInput,
  InvoiceParams,
  PayInvoiceInput,
  StudentQuery,
  ChildParams,
} from './schemas.js';

export { registerParentPortalRoutes } from './routes.js';
export type { ParentPortalRoutesOptions } from './routes.js';
