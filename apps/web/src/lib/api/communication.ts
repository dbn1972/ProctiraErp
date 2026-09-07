/**
 * Communication service client — campaigns and emergency blasts.
 */
import { GatewayError, gatewayFetch } from './gateway';

export interface CommunicationCampaign {
  id: string;
  tenantId: string;
  name: string;
  status: string;
  channels: string[];
  body: string;
  audienceJson: Record<string, unknown>;
  scheduledAt: string | null;
  sentAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmergencyBlast {
  id: string;
  tenantId: string;
  reason: string;
  channels: string[];
  status: string;
  confirmActor1: string | null;
  confirmActor2: string | null;
  confirmedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCampaignInput {
  name: string;
  channels?: string[];
  body?: string;
  audienceJson?: Record<string, unknown>;
  createdBy?: string;
}

export interface AudiencePreview {
  estimatedRecipients: number;
  scope: string;
  breakdown: Record<string, number>;
  honestyNote: string;
  source?: string;
}

export interface CreateEmergencyBlastInput {
  reason: string;
  channels: string[];
  createdBy?: string;
}

export async function listCampaigns(): Promise<CommunicationCampaign[]> {
  const result = await gatewayFetch<{ data: CommunicationCampaign[] }>('/communication/campaigns', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createCampaign(input: CreateCampaignInput): Promise<CommunicationCampaign> {
  const result = await gatewayFetch<CommunicationCampaign>('/communication/campaigns', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create campaign',
    });
  }
  return result.data;
}

export async function previewCampaignAudience(
  audienceJson: Record<string, unknown>,
): Promise<AudiencePreview> {
  const result = await gatewayFetch<AudiencePreview>('/communication/audience/preview', {
    method: 'POST',
    json: { audienceJson },
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'PREVIEW_FAILED',
      message: result.error?.message ?? 'Failed to preview audience',
    });
  }
  return result.data;
}

export interface SendCampaignResult extends CommunicationCampaign {
  delivery: {
    mode: string;
    honestyNote: string;
    estimatedRecipients: number;
  };
}

export async function sendCampaign(id: string): Promise<SendCampaignResult> {
  const result = await gatewayFetch<SendCampaignResult>(`/communication/campaigns/${id}/send`, {
    method: 'POST',
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'SEND_FAILED',
      message: result.error?.message ?? 'Failed to send campaign',
    });
  }
  return result.data;
}

export async function listEmergencyBlasts(): Promise<EmergencyBlast[]> {
  const result = await gatewayFetch<{ data: EmergencyBlast[] }>('/communication/emergency', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createEmergencyBlast(
  input: CreateEmergencyBlastInput,
): Promise<EmergencyBlast> {
  const result = await gatewayFetch<EmergencyBlast>('/communication/emergency', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create emergency blast',
    });
  }
  return result.data;
}

export async function confirmEmergencyBlast(id: string, actorId: string): Promise<EmergencyBlast> {
  const result = await gatewayFetch<EmergencyBlast>(`/communication/emergency/${id}/confirm`, {
    method: 'POST',
    json: { actorId },
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CONFIRM_FAILED',
      message: result.error?.message ?? 'Failed to confirm emergency blast',
    });
  }
  return result.data;
}

export interface DispatchEmergencyResult extends EmergencyBlast {
  delivery: {
    mode: string;
    honestyNote: string;
  };
}

export async function dispatchEmergencyBlast(id: string): Promise<DispatchEmergencyResult> {
  const result = await gatewayFetch<DispatchEmergencyResult>(
    `/communication/emergency/${id}/dispatch`,
    { method: 'POST' },
  );
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'DISPATCH_FAILED',
      message: result.error?.message ?? 'Failed to dispatch emergency blast',
    });
  }
  return result.data;
}
