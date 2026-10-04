'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { GatewayError } from '@/lib/api/gateway';
import {
  acceptAdmissionOffer,
  addEnquiryFollowup,
  bookInterview,
  convertEnquiry,
  createAdmissionOffer,
  createEnquiry,
  createInterviewSlot,
  declineAdmissionOffer,
  generateMeritList,
  sendAdmissionOffer,
  setApplicationPlacement,
  updateApplicationStatus,
  updateEnquiry,
  upsertSeatMatrix,
} from '@/lib/api/admissions';
import {
  acceptOfferFormSchema,
  createEnquiryFormSchema,
  createInterviewSlotFormSchema,
  createOfferFormSchema,
  followupFormSchema,
  generateMeritFormSchema,
  placementScoreFormSchema,
  seatMatrixFormSchema,
  updateEnquiryStageSchema,
} from '@/lib/admissions/validation';

export interface AdmissionsActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  id?: string;
}

const uuid = z.string().uuid();
const APPLICATION_STATUSES = [
  'pending',
  'under_review',
  'approved',
  'rejected',
  'waitlisted',
] as const;
const updateStatusSchema = z.object({
  id: uuid,
  status: z.enum(APPLICATION_STATUSES),
  remarks: z.string().trim().max(2000).optional(),
});
const createSlotSchema = z.object({
  institutionId: uuid,
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  capacity: z.number().int().min(1).max(10_000).optional(),
  location: z.string().trim().max(200).optional(),
});
const bookInterviewSchema = z.object({ slotId: uuid, applicationId: uuid });

function invalid(error: z.ZodError, fallback: string): AdmissionsActionState {
  return { status: 'error', message: error.issues[0]?.message ?? fallback };
}

function fail(error: unknown, fallback: string): AdmissionsActionState {
  return {
    status: 'error',
    message:
      error instanceof GatewayError
        ? error.message
        : error instanceof Error
          ? error.message
          : fallback,
  };
}

export async function updateApplicationStatusAction(input: {
  id: string;
  status: 'pending' | 'under_review' | 'approved' | 'rejected' | 'waitlisted';
  remarks?: string;
}): Promise<AdmissionsActionState> {
  const parsed = updateStatusSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error, 'Invalid status update');
  const { id, status, remarks } = parsed.data;
  try {
    await updateApplicationStatus(id, status, remarks);
    revalidatePath('/admissions');
    return { status: 'success', message: `Status set to ${status}.`, id };
  } catch (error) {
    return fail(error, 'Failed to update status');
  }
}

export async function createInterviewSlotAction(input: {
  institutionId: string;
  startsAt: string;
  endsAt: string;
  capacity?: number;
  location?: string;
}): Promise<AdmissionsActionState> {
  // Boundary schema (uuid institution, offset datetimes) then the form rules
  // from PRC-L23x (end after start, bounded capacity).
  const base = createSlotSchema.safeParse(input);
  if (!base.success) return invalid(base.error, 'Invalid interview slot');
  const parsed = createInterviewSlotFormSchema.safeParse(base.data);
  if (!parsed.success) return invalid(parsed.error, 'Invalid slot');
  try {
    const slot = await createInterviewSlot(parsed.data);
    revalidatePath('/admissions');
    return { status: 'success', message: 'Interview slot created.', id: slot.id };
  } catch (error) {
    return fail(error, 'Failed to create slot');
  }
}

export async function bookInterviewAction(input: {
  slotId: string;
  applicationId: string;
}): Promise<AdmissionsActionState> {
  const parsed = bookInterviewSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error, 'Invalid interview booking');
  try {
    const booking = await bookInterview(parsed.data);
    revalidatePath('/admissions');
    return { status: 'success', message: 'Interview booked.', id: booking.id };
  } catch (error) {
    return fail(error, 'Failed to book interview');
  }
}

export async function createEnquiryAction(input: unknown): Promise<AdmissionsActionState> {
  const parsed = createEnquiryFormSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid enquiry' };
  }
  try {
    const enquiry = await createEnquiry(parsed.data);
    revalidatePath('/admissions');
    revalidatePath('/admissions/enquiries');
    return { status: 'success', message: 'Enquiry created.', id: enquiry.id };
  } catch (error) {
    return fail(error, 'Failed to create enquiry');
  }
}

export async function updateEnquiryStageAction(input: unknown): Promise<AdmissionsActionState> {
  const parsed = updateEnquiryStageSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid stage' };
  }
  try {
    await updateEnquiry(parsed.data.id, { stage: parsed.data.stage });
    revalidatePath('/admissions/enquiries');
    return { status: 'success', message: `Stage set to ${parsed.data.stage}.`, id: parsed.data.id };
  } catch (error) {
    return fail(error, 'Failed to update stage');
  }
}

export async function addFollowupAction(input: unknown): Promise<AdmissionsActionState> {
  const parsed = followupFormSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid follow-up' };
  }
  try {
    const row = await addEnquiryFollowup(parsed.data.enquiryId, {
      dueAt: parsed.data.dueAt,
      ownerId: parsed.data.ownerId,
      notes: parsed.data.notes,
    });
    revalidatePath('/admissions/enquiries');
    return { status: 'success', message: 'Follow-up added.', id: row.id };
  } catch (error) {
    return fail(error, 'Failed to add follow-up');
  }
}

export async function convertEnquiryAction(id: string): Promise<AdmissionsActionState> {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return { status: 'error', message: 'Invalid enquiry id' };
  try {
    const result = await convertEnquiry(id);
    revalidatePath('/admissions');
    revalidatePath('/admissions/enquiries');
    revalidatePath(`/admissions/${result.application.id}`);
    return {
      status: 'success',
      message: `Application ${result.application.trackingNumber} created.`,
      id: result.application.id,
    };
  } catch (error) {
    return fail(error, 'Failed to convert enquiry');
  }
}

export async function upsertSeatMatrixAction(input: unknown): Promise<AdmissionsActionState> {
  const parsed = seatMatrixFormSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid seat row' };
  }
  try {
    const row = await upsertSeatMatrix(parsed.data);
    revalidatePath('/admissions/seat-matrix');
    return { status: 'success', message: 'Seat matrix saved.', id: row.id };
  } catch (error) {
    return fail(error, 'Failed to save seat matrix');
  }
}

export async function generateMeritListAction(input: unknown): Promise<AdmissionsActionState> {
  const parsed = generateMeritFormSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid merit request' };
  }
  try {
    const list = await generateMeritList(parsed.data);
    revalidatePath('/admissions/merit');
    return { status: 'success', message: 'Merit list generated.', id: list.id };
  } catch (error) {
    return fail(error, 'Failed to generate merit list');
  }
}

export async function setPlacementScoresAction(input: unknown): Promise<AdmissionsActionState> {
  const parsed = placementScoreFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid placement / scores',
    };
  }
  try {
    const { applicationId, ...body } = parsed.data;
    await setApplicationPlacement(applicationId, body);
    revalidatePath('/admissions/merit');
    revalidatePath(`/admissions/${applicationId}`);
    return {
      status: 'success',
      message: 'Placement and entrance scores saved.',
      id: applicationId,
    };
  } catch (error) {
    return fail(error, 'Failed to save placement / scores');
  }
}

export async function createOfferAction(input: unknown): Promise<AdmissionsActionState> {
  const parsed = createOfferFormSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid offer' };
  }
  try {
    const offer = await createAdmissionOffer(parsed.data);
    revalidatePath(`/admissions/${parsed.data.applicationId}`);
    return { status: 'success', message: 'Offer drafted.', id: offer.id };
  } catch (error) {
    return fail(error, 'Failed to create offer');
  }
}

export async function sendOfferAction(
  offerId: string,
  applicationId: string,
): Promise<AdmissionsActionState> {
  if (!uuid.safeParse(offerId).success || !uuid.safeParse(applicationId).success) {
    return { status: 'error', message: 'Invalid offer id' };
  }
  try {
    const offer = await sendAdmissionOffer(offerId);
    revalidatePath(`/admissions/${applicationId}`);
    return { status: 'success', message: 'Offer sent.', id: offer.id };
  } catch (error) {
    return fail(error, 'Failed to send offer');
  }
}

export async function acceptOfferAction(input: unknown): Promise<AdmissionsActionState> {
  const parsed = acceptOfferFormSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid accept' };
  }
  try {
    const offer = await acceptAdmissionOffer(parsed.data.offerId, {
      paymentRef: parsed.data.paymentRef,
      offerFeeInvoiceId: parsed.data.offerFeeInvoiceId,
    });
    revalidatePath(`/admissions/${offer.applicationId}`);
    if (offer.enrolledStudentId) revalidatePath(`/students/${offer.enrolledStudentId}`);
    return {
      status: 'success',
      message: 'Offer accepted.',
      id: offer.enrolledStudentId ?? offer.id,
    };
  } catch (error) {
    return fail(error, 'Failed to accept offer');
  }
}

export async function declineOfferAction(
  offerId: string,
  applicationId: string,
): Promise<AdmissionsActionState> {
  if (!uuid.safeParse(offerId).success || !uuid.safeParse(applicationId).success) {
    return { status: 'error', message: 'Invalid offer id' };
  }
  try {
    const offer = await declineAdmissionOffer(offerId);
    revalidatePath(`/admissions/${applicationId}`);
    return { status: 'success', message: 'Offer declined.', id: offer.id };
  } catch (error) {
    return fail(error, 'Failed to decline offer');
  }
}
