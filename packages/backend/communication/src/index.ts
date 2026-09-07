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
} from './schemas.js';
export type {
  CreateCampaignInput,
  CreateEmergencyBlastInput,
  ConfirmEmergencyInput,
} from './schemas.js';

export { registerCommunicationRoutes } from './routes.js';
export type { CommunicationRoutesOptions } from './routes.js';
