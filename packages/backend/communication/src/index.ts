/**
 * @proctira/backend-communication — campaigns and emergency blasts.
 */

export { communicationPlugin } from './communication-plugin.js';
export type { CommunicationPluginOptions } from './communication-plugin.js';

export { CommunicationService } from './communication-service.js';

export type {
  CampaignEntity,
  EmergencyBlastEntity,
  CommunicationRepository,
} from './communication-repository.js';

export { InMemoryCommunicationRepository } from './in-memory-repository.js';

export {
  createCommunicationRepository,
  isPgCommunicationEnabled,
} from './create-communication-repository.js';
export {
  PgCommunicationRepository,
  createPgCommunicationRepository,
  getSharedCommunicationPool,
  ensureCommunicationSchema,
} from './pg-communication-repository.js';

export {
  CreateCampaignSchema,
  CreateEmergencyBlastSchema,
  ConfirmEmergencySchema,
  CampaignParamsSchema,
  EmergencyParamsSchema,
  AudiencePreviewSchema,
} from './schemas.js';
export type {
  CreateCampaignInput,
  CreateEmergencyBlastInput,
  ConfirmEmergencyInput,
  AudiencePreviewInput,
} from './schemas.js';

export { estimateAudience } from './audience.js';
export type { AudiencePreviewResult } from './audience.js';
export { fetchLiveAudienceCounts } from './live-audience.js';
export type { LiveAudienceCounts } from './live-audience.js';

export { createSandboxDeliveryAdapter, COMMS_SANDBOX_HONESTY_NOTE } from './delivery-adapter.js';
export type {
  CommunicationDeliveryAdapter,
  DeliveryRequest,
  DeliveryResult,
  DeliveryChannel,
} from './delivery-adapter.js';

export type { CommunicationAuditEvent, CommunicationAuditSink } from './communication-service.js';

export { registerCommunicationRoutes } from './routes.js';
export type { CommunicationRoutesOptions } from './routes.js';

export { CircularsService } from './circulars-service.js';
export { registerCircularRoutes } from './circulars-routes.js';
export { InMemoryCircularStore } from './circular-store.js';
export { PgCircularStore, ensureCircularSchema } from './pg-circular-store.js';
export { createCircularStore } from './create-circular-store.js';
export {
  createSandboxWhatsAppAdapter,
  WHATSAPP_SANDBOX_HONESTY_NOTE,
  WHATSAPP_LIVE_ENV_VARS,
} from './whatsapp-adapter.js';
export type {
  WhatsAppChannelAdapter,
  WhatsAppSendRequest,
  WhatsAppSendResult,
} from './whatsapp-adapter.js';
export { CreateCircularSchema, AckCircularSchema } from './circular-schemas.js';
