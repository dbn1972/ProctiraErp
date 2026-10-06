'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import {
  ackCircularOnBehalf,
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
import { requireSession } from '@/lib/auth/server';
import { INVALID_ID_MESSAGE, areValidActionIds } from '@/lib/validation/campus-action-schema';
import {
  ACK_ON_BEHALF_REASON_MAX,
  circularFormSchema,
} from '@/lib/validation/communication-schema';

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
  if (!areValidActionIds(id)) return { status: 'error', message: INVALID_ID_MESSAGE };
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
    // PRC-M074: only a live count is data. The fixed-base estimator is not a
    // recipient number and must not be shown as a headline figure.
    if (preview.source !== 'live') {
      return {
        status: 'success',
        message:
          'Estimate unavailable — a live recipient count is not available for this audience.',
        honestyNote: preview.honestyNote,
      };
    }
    return {
      status: 'success',
      message: `${preview.estimatedRecipients} recipients (live count).`,
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
  // PRC-L235: the author is the signed-in user, never a client-supplied id.
  // Outside try so the login redirect is not swallowed as an error state.
  const session = await requireSession('/communication/emergency');
  try {
    const blast = await createEmergencyBlast({ ...input, createdBy: session.user.sub });
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

export async function confirmEmergencyBlastAction(id: string): Promise<CommunicationActionState> {
  // PRC-L033: never interpolate a non-UUID into the gateway path.
  if (!areValidActionIds(id)) return { status: 'error', message: INVALID_ID_MESSAGE };
  // PRC-L235: two-person control is only meaningful if each confirmation is
  // bound to the session; a client-supplied actor id could forge the second.
  const session = await requireSession('/communication/emergency');
  try {
    const blast = await confirmEmergencyBlast(id, session.user.sub);
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
  if (!areValidActionIds(id)) return { status: 'error', message: INVALID_ID_MESSAGE };
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

export async function createCircularAction(
  input: CreateCircularInput,
): Promise<CommunicationActionState> {
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
    return {
      status: 'error',
      message: 'Acknowledgement circulars need at least one recipient id.',
    };
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
  if (!areValidActionIds(id)) return { status: 'error', message: INVALID_ID_MESSAGE };
  try {
    const circular = await sendCircular(id);
    revalidatePath('/communication/circulars');
    revalidatePath(`/communication/circulars/${id}`);
    revalidatePath('/communication/delivery');
    return {
      status: 'success',
      message: `Circular marked sent (${circular.status}).`,
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
            : 'Failed to send circular',
    };
  }
}

/**
 * Records an acknowledgement on behalf of a recipient (admin-only on the
 * gateway). A reason is required and is written to the audit trail.
 */
export async function ackCircularAction(
  id: string,
  recipientId: string,
  reason: string,
): Promise<CommunicationActionState> {
  if (!areValidActionIds(id)) return { status: 'error', message: INVALID_ID_MESSAGE };
  if (!recipientId.trim()) {
    return { status: 'error', message: 'Recipient id is required.' };
  }
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { status: 'error', message: 'A reason is required.' };
  }
  if (trimmedReason.length > ACK_ON_BEHALF_REASON_MAX) {
    return {
      status: 'error',
      message: `Reason must be ${ACK_ON_BEHALF_REASON_MAX} characters or fewer.`,
    };
  }
  try {
    const circular = await ackCircularOnBehalf(id, recipientId.trim(), trimmedReason);
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
  if (!areValidActionIds(id)) return { status: 'error', message: INVALID_ID_MESSAGE };
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
