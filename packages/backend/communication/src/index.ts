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

export { registerCommunicationRoutes } from './routes.js';
export type { CommunicationRoutesOptions } from './routes.js';
