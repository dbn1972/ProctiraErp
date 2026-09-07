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

export { CreateLibraryItemSchema, CheckoutSchema, ReturnSchema } from './schemas.js';
export type { CreateLibraryItemInput, CheckoutInput, ReturnInput } from './schemas.js';

export { registerLibraryRoutes } from './routes.js';
export type { LibraryRoutesOptions } from './routes.js';
