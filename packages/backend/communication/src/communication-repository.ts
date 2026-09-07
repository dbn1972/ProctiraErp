/**
 * Communication repository interface (in-memory v1).
 */

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
export type EmergencyStatus = 'pending_confirm' | 'confirmed' | 'sent' | 'cancelled';

export interface CampaignEntity {
  id: string;
  tenantId: string;
  name: string;
  status: CampaignStatus;
  channels: string[];
  body: string;
  audienceJson: Record<string, unknown>;
  scheduledAt: Date | null;
  sentAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmergencyBlastEntity {
  id: string;
  tenantId: string;
  reason: string;
  channels: string[];
  status: EmergencyStatus;
  confirmActor1: string | null;
  confirmActor2: string | null;
  confirmedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommunicationRepository {
  createCampaign(data: Omit<CampaignEntity, 'createdAt' | 'updatedAt'>): Promise<CampaignEntity>;
  listCampaigns(tenantId: string): Promise<CampaignEntity[]>;
  findCampaignById(id: string, tenantId: string): Promise<CampaignEntity | null>;

  createEmergencyBlast(
    data: Omit<EmergencyBlastEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<EmergencyBlastEntity>;
  listEmergencyBlasts(tenantId: string): Promise<EmergencyBlastEntity[]>;
  findEmergencyBlastById(id: string, tenantId: string): Promise<EmergencyBlastEntity | null>;
  updateEmergencyBlast(
    id: string,
    tenantId: string,
    data: Partial<
      Pick<EmergencyBlastEntity, 'confirmActor1' | 'confirmActor2' | 'confirmedAt' | 'status'>
    >,
  ): Promise<EmergencyBlastEntity | null>;
}
