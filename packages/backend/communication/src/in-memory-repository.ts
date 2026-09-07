/**
 * In-memory communication repository (v1 gateway default).
 */
import type {
  CampaignEntity,
  CommunicationRepository,
  EmergencyBlastEntity,
} from './communication-repository.js';

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

  async listCampaigns(tenantId: string): Promise<CampaignEntity[]> {
    return this.campaigns.filter((c) => c.tenantId === tenantId);
  }

  async findCampaignById(id: string, tenantId: string): Promise<CampaignEntity | null> {
    return this.campaigns.find((c) => c.id === id && c.tenantId === tenantId) ?? null;
  }

  async createEmergencyBlast(
    data: Omit<EmergencyBlastEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<EmergencyBlastEntity> {
    const now = new Date();
    const entity: EmergencyBlastEntity = { ...data, createdAt: now, updatedAt: now };
    this.emergencyBlasts.push(entity);
    return entity;
  }

  async listEmergencyBlasts(tenantId: string): Promise<EmergencyBlastEntity[]> {
    return this.emergencyBlasts.filter((b) => b.tenantId === tenantId);
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
