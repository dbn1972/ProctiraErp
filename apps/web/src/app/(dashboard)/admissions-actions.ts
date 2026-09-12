'use server';

import { revalidatePath } from 'next/cache';

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
  try {
    await updateApplicationStatus(input.id, input.status, input.remarks);
    revalidatePath('/admissions');
    return { status: 'success', message: `Status set to ${input.status}.`, id: input.id };
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
  try {
    const slot = await createInterviewSlot(input);
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
  try {
    const booking = await bookInterview(input);
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
  try {
    const offer = await declineAdmissionOffer(offerId);
    revalidatePath(`/admissions/${applicationId}`);
    return { status: 'success', message: 'Offer declined.', id: offer.id };
  } catch (error) {
    return fail(error, 'Failed to decline offer');
  }
}
