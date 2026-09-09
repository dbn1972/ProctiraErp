'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import {
  ackCircular,
  confirmEmergencyBlast,
  createCampaign,
  createCircular,
  createEmergencyBlast,
  dispatchEmergencyBlast,
  previewCampaignAudience,
  retryDeliveryLog,
  sendCampaign,
  sendCircular,
  type CreateCampaignInput,
  type CreateCircularInput,
  type CreateEmergencyBlastInput,
} from '@/lib/api/communication';
import { circularFormSchema } from '@/lib/validation/communication-schema';

export interface CommunicationActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  id?: string;
  estimatedRecipients?: number;
  honestyNote?: string;
}

export async function createCampaignAction(
  input: CreateCampaignInput,
): Promise<CommunicationActionState> {
  try {
    const campaign = await createCampaign(input);
    revalidatePath('/communication');
    revalidatePath('/communication/campaigns');
    return { status: 'success', message: 'Campaign created.', id: campaign.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to create campaign',
    };
  }
}

export async function sendCampaignAction(id: string): Promise<CommunicationActionState> {
  try {
    const result = await sendCampaign(id);
    revalidatePath('/communication');
    revalidatePath('/communication/campaigns');
    return {
      status: 'success',
      message: `Campaign marked sent (${result.delivery.mode}).`,
      id: result.id,
      estimatedRecipients: result.delivery.estimatedRecipients,
      honestyNote: result.delivery.honestyNote,
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to send campaign',
    };
  }
}

export async function previewAudienceAction(
  audienceJson: Record<string, unknown>,
): Promise<CommunicationActionState> {
  try {
    const preview = await previewCampaignAudience(audienceJson);
    return {
      status: 'success',
      message: `Estimated ${preview.estimatedRecipients} recipients.`,
      estimatedRecipients: preview.estimatedRecipients,
      honestyNote: preview.honestyNote,
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Audience preview failed',
    };
  }
}

export async function createEmergencyBlastAction(
  input: CreateEmergencyBlastInput,
): Promise<CommunicationActionState> {
  try {
    const blast = await createEmergencyBlast(input);
    revalidatePath('/communication/emergency');
    return { status: 'success', message: 'Emergency blast drafted.', id: blast.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to create emergency blast',
    };
  }
}

export async function confirmEmergencyBlastAction(
  id: string,
  actorId: string,
): Promise<CommunicationActionState> {
  try {
    const blast = await confirmEmergencyBlast(id, actorId);
    revalidatePath('/communication/emergency');
    return {
      status: 'success',
      message:
        blast.status === 'confirmed'
          ? 'Second confirmation recorded — blast confirmed.'
          : 'First confirmation recorded — awaiting second actor.',
      id: blast.id,
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to confirm emergency blast',
    };
  }
}

export async function dispatchEmergencyBlastAction(id: string): Promise<CommunicationActionState> {
  try {
    const result = await dispatchEmergencyBlast(id);
    revalidatePath('/communication/emergency');
    return {
      status: 'success',
      message: `Emergency blast dispatched (${result.delivery.mode}).`,
      id: result.id,
      honestyNote: result.delivery.honestyNote,
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to dispatch emergency blast',
    };
  }
}

export async function createCircularAction(input: CreateCircularInput): Promise<CommunicationActionState> {
  const parsed = circularFormSchema.safeParse({
    title: input.title,
    body: input.body,
    audienceType: input.audienceType,
    requiresAck: input.requiresAck,
    channels: input.channels,
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid circular' };
  }
  if (input.requiresAck && (!input.recipientIds || input.recipientIds.length === 0)) {
    return { status: 'error', message: 'Acknowledgement circulars need at least one recipient id.' };
  }
  try {
    const circular = await createCircular(input);
    revalidatePath('/communication');
    revalidatePath('/communication/circulars');
    return { status: 'success', message: 'Circular drafted.', id: circular.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to create circular',
    };
  }
}

export async function sendCircularAction(id: string): Promise<CommunicationActionState> {
  try {
    const circular = await sendCircular(id);
    revalidatePath('/communication/circulars');
    revalidatePath(`/communication/circulars/${id}`);
    revalidatePath('/communication/delivery');
    return { status: 'success', message: `Circular marked sent (${circular.status}).`, id: circular.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to send circular',
    };
  }
}

export async function ackCircularAction(
  id: string,
  recipientId: string,
): Promise<CommunicationActionState> {
  if (!recipientId.trim()) {
    return { status: 'error', message: 'Recipient id is required.' };
  }
  try {
    const circular = await ackCircular(id, recipientId.trim());
    revalidatePath(`/communication/circulars/${id}`);
    return {
      status: 'success',
      message: `Acknowledged (${Math.round(circular.ackRate * 100)}% ack rate).`,
      id: circular.id,
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to acknowledge circular',
    };
  }
}

export async function retryDeliveryAction(id: string): Promise<CommunicationActionState> {
  try {
    const row = await retryDeliveryLog(id);
    revalidatePath('/communication/delivery');
    return { status: 'success', message: `Retried (${row.status}).`, id: row.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to retry delivery',
    };
  }
}
