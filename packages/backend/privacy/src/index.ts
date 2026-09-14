export { privacyPlugin } from './privacy-plugin.js';
export type { PrivacyPluginOptions } from './privacy-plugin.js';
export { PrivacyService } from './privacy-service.js';
export type { DestructiveDeleteGuard } from './privacy-service.js';
export type {
  ErasureRequestEntity,
  LegalHoldEntity,
  PrivacyRepository,
} from './privacy-repository.js';
export { InMemoryPrivacyRepository } from './in-memory-repository.js';
export {
  LegalHoldScopeEnum,
  ErasureStatusEnum,
  ErasureRequestTypeEnum,
  PlaceLegalHoldSchema,
  CreateErasureRequestSchema,
} from './schemas.js';
export type {
  LegalHoldScope,
  ErasureStatus,
  ErasureRequestType,
  PlaceLegalHoldInput,
  CreateErasureRequestInput,
} from './schemas.js';
export { registerPrivacyRoutes } from './routes.js';
export type { PrivacyRoutesOptions } from './routes.js';
