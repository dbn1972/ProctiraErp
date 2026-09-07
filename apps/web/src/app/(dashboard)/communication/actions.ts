'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import {
  confirmEmergencyBlast,
  createCampaign,
  createEmergencyBlast,
  type CreateCampaignInput,
  type CreateEmergencyBlastInput,
} from '@/lib/api/communication';

export interface CommunicationActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  id?: string;
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
