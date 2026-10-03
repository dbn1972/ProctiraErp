/**
 * In-memory communication repository (v1 gateway default).
 */
import type {
  CampaignEntity,
  CommunicationRepository,
  EmergencyBlastEntity,
} from './communication-repository.js';
import { DEFAULT_PAGE, sliceForPage, type PageRequest } from './pagination.js';

export class InMemoryCommunicationRepository implements CommunicationRepository {
  private campaigns: CampaignEntity[] = [];
  private emergencyBlasts: EmergencyBlastEntity[] = [];

  async createCampaign(
    data: Omit<CampaignEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<CampaignEntity> {
    const now = new Date();
    const entity: CampaignEntity = { ...data, createdAt: now, updatedAt: now };
    this.campaigns.push(entity);
    return entity;
  }

  async listCampaigns(
    tenantId: string,
    page: PageRequest = DEFAULT_PAGE,
  ): Promise<CampaignEntity[]> {
    const rows = this.campaigns
      .filter((c) => c.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return sliceForPage(rows, page);
  }

  async findCampaignById(id: string, tenantId: string): Promise<CampaignEntity | null> {
    return this.campaigns.find((c) => c.id === id && c.tenantId === tenantId) ?? null;
  }

  async updateCampaign(
    id: string,
    tenantId: string,
    data: Partial<Pick<CampaignEntity, 'status' | 'scheduledAt' | 'sentAt'>>,
  ): Promise<CampaignEntity | null> {
    const index = this.campaigns.findIndex((c) => c.id === id && c.tenantId === tenantId);
    if (index === -1) return null;
    const updated: CampaignEntity = {
      ...this.campaigns[index]!,
      ...data,
      updatedAt: new Date(),
    };
    this.campaigns[index] = updated;
    return updated;
  }

  async createEmergencyBlast(
    data: Omit<EmergencyBlastEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<EmergencyBlastEntity> {
    const now = new Date();
    const entity: EmergencyBlastEntity = { ...data, createdAt: now, updatedAt: now };
    this.emergencyBlasts.push(entity);
    return entity;
  }

  async listEmergencyBlasts(
    tenantId: string,
    page: PageRequest = DEFAULT_PAGE,
  ): Promise<EmergencyBlastEntity[]> {
    const rows = this.emergencyBlasts
      .filter((b) => b.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return sliceForPage(rows, page);
  }

  async findEmergencyBlastById(id: string, tenantId: string): Promise<EmergencyBlastEntity | null> {
    return this.emergencyBlasts.find((b) => b.id === id && b.tenantId === tenantId) ?? null;
  }

  async updateEmergencyBlast(
    id: string,
    tenantId: string,
    data: Partial<
      Pick<EmergencyBlastEntity, 'confirmActor1' | 'confirmActor2' | 'confirmedAt' | 'status'>
    >,
  ): Promise<EmergencyBlastEntity | null> {
    const index = this.emergencyBlasts.findIndex((b) => b.id === id && b.tenantId === tenantId);
    if (index === -1) return null;
    const updated: EmergencyBlastEntity = {
      ...this.emergencyBlasts[index]!,
      ...data,
      updatedAt: new Date(),
    };
    this.emergencyBlasts[index] = updated;
    return updated;
  }
}
