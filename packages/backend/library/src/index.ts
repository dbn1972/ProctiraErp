/**
 * @proctira/backend-library — catalog and circulation.
 */

export { libraryPlugin } from './library-plugin.js';
export type { LibraryPluginOptions } from './library-plugin.js';

export { LibraryService } from './library-service.js';

export type {
  LibraryItemEntity,
  LibraryLoanEntity,
  LibraryRepository,
} from './library-repository.js';

export { InMemoryLibraryRepository } from './in-memory-repository.js';

export { createLibraryRepository, isPgLibraryEnabled } from './create-library-repository.js';
export {
  PgLibraryRepository,
  createPgLibraryRepository,
  getSharedLibraryPool,
  ensureLibrarySchema,
} from './pg-library-repository.js';

export {
  CreateLibraryItemSchema,
  CheckoutSchema,
  ReturnSchema,
  RenewSchema,
  PatronParamsSchema,
  AssessFineSchema,
} from './schemas.js';
export type {
  CreateLibraryItemInput,
  CheckoutInput,
  ReturnInput,
  RenewInput,
  PatronParams,
  AssessFineInput,
} from './schemas.js';

export type {
  FeesLedgerPort,
  LibraryFineInvoiceInput,
  LibraryFineInvoiceResult,
} from './fees-ledger-port.js';
export { InMemoryFeesLedgerPort } from './fees-ledger-port.js';

export { registerLibraryRoutes } from './routes.js';
export type { LibraryRoutesOptions } from './routes.js';
