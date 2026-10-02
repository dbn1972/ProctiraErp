'use server';

import { revalidatePath } from 'next/cache';
import { parseActionInput } from '@/lib/validation/server-action-input';
import { INVALID_ID_MESSAGE, areValidActionIds } from '@/lib/validation/campus-action-schema';
import {
  guardianOfferAcceptSchema,
  parentConsentDecisionSchema,
  parentReplyInputSchema,
  parentThreadInputSchema,
} from '@/lib/validation/dashboard-action-schemas';

import { GatewayError } from '@/lib/api/gateway';
import {
  acceptGuardianOffer,
  createThread,
  decideConsent,
  payInvoice,
  replyToThread,
  type CreateThreadInput,
} from '@/lib/api/parent-portal';

export interface ParentActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  id?: string;
}

export async function createThreadAction(input: CreateThreadInput): Promise<ParentActionState> {
  const parsed = parseActionInput(parentThreadInputSchema, input);
  if (!parsed.ok) return { status: 'error', message: parsed.message };
  input = parsed.data;
  try {
    const { thread } = await createThread(input);
    revalidatePath('/parent/messages');
    return { status: 'success', message: 'Message thread created.', id: thread.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to create thread',
    };
  }
}

export async function replyToThreadAction(
  threadId: string,
  body: string,
): Promise<ParentActionState> {
  const parsed = parseActionInput(parentReplyInputSchema, { threadId, body });
  if (!parsed.ok) return { status: 'error', message: parsed.message };
  try {
    const message = await replyToThread(threadId, body);
    revalidatePath(`/parent/messages/${threadId}`);
    revalidatePath('/parent/messages');
    return { status: 'success', message: 'Reply sent.', id: message.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to send reply',
    };
  }
}

export async function decideConsentAction(
  id: string,
  status: 'approved' | 'denied',
): Promise<ParentActionState> {
  const parsed = parseActionInput(parentConsentDecisionSchema, { id, status });
  if (!parsed.ok) return { status: 'error', message: parsed.message };
  try {
    await decideConsent(id, status);
    revalidatePath('/parent/consents');
    return {
      status: 'success',
      message: status === 'approved' ? 'Consent approved.' : 'Consent denied.',
      id,
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to decide consent',
    };
  }
}

export async function payInvoiceAction(invoiceId: string): Promise<ParentActionState> {
  if (!areValidActionIds(invoiceId)) return { status: 'error', message: INVALID_ID_MESSAGE };
  try {
    const { payment, receipt } = await payInvoice(invoiceId, 'sandbox');
    revalidatePath('/parent/fees');
    return {
      status: 'success',
      message: `Payment recorded (sandbox). Receipt ${receipt.receiptNumber}.`,
      id: payment.id,
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to pay invoice',
    };
  }
}

export async function acceptGuardianOfferAction(input: {
  offerId: string;
  paymentRef: string;
  offerFeeInvoiceId?: string;
}): Promise<ParentActionState> {
  const parsed = parseActionInput(guardianOfferAcceptSchema, input);
  if (!parsed.ok) return { status: 'error', message: parsed.message };
  input = parsed.data;
  try {
    const offer = await acceptGuardianOffer(input.offerId, {
      paymentRef: input.paymentRef,
      offerFeeInvoiceId: input.offerFeeInvoiceId,
    });
    revalidatePath('/parent/offers');
    revalidatePath('/parent/fees');
    revalidatePath('/parent');
    return {
      status: 'success',
      message: offer.enrolledStudentId
        ? 'Offer accepted. Your child is enrolled.'
        : 'Offer accepted.',
      id: offer.enrolledStudentId ?? offer.id,
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to accept offer',
    };
  }
}
