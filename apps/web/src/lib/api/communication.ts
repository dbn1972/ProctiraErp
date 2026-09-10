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

/* ------------------------------------------------------------- G-922 circulars */

export type CircularAudienceType = 'all' | 'roles' | 'classes' | 'institution';

export interface CommunicationCircular {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  audienceType: string;
  audienceJson: Record<string, unknown>;
  requiresAck: boolean;
  channels: string[];
  status: string;
  createdBy: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  ackTotal: number;
  ackCount: number;
  ackRate: number;
  acks: Array<{
    id: string;
    recipientId: string;
    recipientLabel: string | null;
    acknowledgedAt: string | null;
  }>;
}

export interface DeliveryLogEntry {
  id: string;
  tenantId: string;
  channel: string;
  recipientId: string;
  recipientLabel: string | null;
  status: string;
  providerRef: string | null;
  sourceType: string;
  sourceId: string | null;
  errorMessage: string | null;
  queuedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  retriedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCircularInput {
  title: string;
  body: string;
  audienceType: CircularAudienceType;
  audienceIds?: string[];
  requiresAck?: boolean;
  channels?: string[];
  recipientIds?: string[];
  recipientLabels?: Record<string, string>;
  createdBy?: string;
}

export async function listCirculars(): Promise<CommunicationCircular[]> {
  const result = await gatewayFetch<{ data: CommunicationCircular[] }>('/communication/circulars', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function getCircular(id: string): Promise<CommunicationCircular | null> {
  const result = await gatewayFetch<CommunicationCircular>(`/communication/circulars/${id}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.ok ? result.data : null;
}

export async function createCircular(input: CreateCircularInput): Promise<CommunicationCircular> {
  const result = await gatewayFetch<CommunicationCircular>('/communication/circulars', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create circular',
    });
  }
  return result.data;
}

export async function sendCircular(id: string): Promise<CommunicationCircular> {
  const result = await gatewayFetch<CommunicationCircular>(`/communication/circulars/${id}/send`, {
    method: 'POST',
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'SEND_FAILED',
      message: result.error?.message ?? 'Failed to send circular',
    });
  }
  return result.data;
}

export async function ackCircular(id: string, recipientId: string): Promise<CommunicationCircular> {
  const result = await gatewayFetch<CommunicationCircular>(`/communication/circulars/${id}/ack`, {
    method: 'POST',
    json: { recipientId },
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'ACK_FAILED',
      message: result.error?.message ?? 'Failed to acknowledge circular',
    });
  }
  return result.data;
}

export async function listDeliveryLogs(
  filters: {
    channel?: string;
    status?: string;
    sourceType?: string;
  } = {},
): Promise<DeliveryLogEntry[]> {
  const params = new URLSearchParams();
  if (filters.channel) params.set('channel', filters.channel);
  if (filters.status) params.set('status', filters.status);
  if (filters.sourceType) params.set('sourceType', filters.sourceType);
  const qs = params.toString();
  const result = await gatewayFetch<{ data: DeliveryLogEntry[] }>(
    `/communication/delivery-log${qs ? `?${qs}` : ''}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function retryDeliveryLog(id: string): Promise<DeliveryLogEntry> {
  const result = await gatewayFetch<DeliveryLogEntry>(`/communication/delivery-log/${id}/retry`, {
    method: 'POST',
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'RETRY_FAILED',
      message: result.error?.message ?? 'Failed to retry delivery',
    });
  }
  return result.data;
}
