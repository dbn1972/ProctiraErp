/**
 * @proctira/backend-parent-portal — child links, messaging, consents, fees.
 */

export { parentPortalPlugin } from './parent-portal-plugin.js';
export type { ParentPortalPluginOptions } from './parent-portal-plugin.js';

export { ParentPortalService } from './parent-portal-service.js';

export type {
  ParentChildLinkEntity,
  MessageThreadEntity,
  MessageEntity,
  ConsentEntity,
  FeeInvoiceEntity,
  FeePaymentEntity,
  ParentPortalRepository,
} from './parent-portal-repository.js';

export { InMemoryParentPortalRepository } from './in-memory-repository.js';

export {
  createParentPortalRepository,
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
} from './schemas.js';

export { registerParentPortalRoutes } from './routes.js';
export type { ParentPortalRoutesOptions } from './routes.js';
