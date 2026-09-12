/**
 * @proctira/backend-library — catalog, circulation, holds, OPAC, fines (G-916).
 * Acquisitions (vendors/POs/receiving) = NON-GOAL dated 2026-09-12 (PRD-017).
 * See packages/backend/library/README.md and docs/audits/DEV_P2_LIB_CIRCULATION_ACQ.md.
 */

export { libraryPlugin } from './library-plugin.js';
export type { LibraryPluginOptions } from './library-plugin.js';

export { LibraryService } from './library-service.js';
export type { LibraryFinesPort, LibraryFinesSummary, PlaceHoldInput } from './library-service.js';

export type {
  LibraryItemEntity,
  LibraryLoanEntity,
  LibraryCopyEntity,
  LibraryHoldEntity,
  LibraryFinePolicyEntity,
  LibraryFineEntity,
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
  ImportIsbnSchema,
  PlaceHoldSchema,
} from './schemas.js';
export type {
  CreateLibraryItemInput,
  CheckoutInput,
  ReturnInput,
  RenewInput,
  PatronParams,
  AssessFineInput,
  ImportIsbnInput,
} from './schemas.js';

export type {
  FeesLedgerPort,
  LibraryFineInvoiceInput,
  LibraryFineInvoiceResult,
} from './fees-ledger-port.js';
export { InMemoryFeesLedgerPort } from './fees-ledger-port.js';

export {
  createIsbnLookup,
  StubIsbnLookup,
  OpenLibraryIsbnLookup,
  normalizeIsbn,
} from './isbn-lookup.js';
export type { IsbnLookup, IsbnLookupResult } from './isbn-lookup.js';

export { computeFineCents, overdueDaysSince, HOLD_READY_MS } from './library-ops.js';

export { registerLibraryRoutes, type PatronBinding } from './routes.js';
export type { LibraryRoutesOptions } from './routes.js';
