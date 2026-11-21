'use server';

/**
 * Server Actions for Health redesign write paths.
 */
import { revalidatePath } from 'next/cache';

import { genericActionErrorMessage } from '@/lib/api/action-error';
import {
  createAllergy,
  createCounsellingSession,
  createNurseIncident,
  createVaccination,
  type CreateAllergyInput,
  type CreateCounsellingSessionInput,
  type CreateNurseIncidentInput,
  type CreateVaccinationInput,
} from '@/lib/api/health';

export interface HealthActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  sessionId?: string;
}

export async function createCounsellingSessionAction(
  input: CreateCounsellingSessionInput,
): Promise<HealthActionState> {
  try {
    const session = await createCounsellingSession(input);
    revalidatePath('/health/counselling');
    revalidatePath('/health/counselling/new');
    return {
      status: 'success',
      message: 'Counselling session scheduled.',
      sessionId: session.id,
    };
  } catch (error) {
    // RAW-WEB: fixed copy plus a reference, never gateway or server text.
    return {
      status: 'error',
      message: genericActionErrorMessage(error, 'Failed to create counselling session'),
    };
  }
}

export async function createAllergyAction(input: CreateAllergyInput): Promise<HealthActionState> {
  try {
    const row = await createAllergy(input);
    revalidatePath('/health');
    revalidatePath('/health/allergies');
    revalidatePath(`/health/${input.studentId}`);
    return { status: 'success', message: 'Allergy recorded.', sessionId: row.id };
  } catch (error) {
    // RAW-WEB: fixed copy plus a reference, never gateway or server text.
    return {
      status: 'error',
      message: genericActionErrorMessage(error, 'Failed to create allergy'),
    };
  }
}

export async function createVaccinationAction(
  input: CreateVaccinationInput,
): Promise<HealthActionState> {
  try {
    const row = await createVaccination(input);
    revalidatePath('/health');
    revalidatePath('/health/vaccinations');
    revalidatePath(`/health/${input.studentId}`);
    return { status: 'success', message: 'Vaccination recorded.', sessionId: row.id };
  } catch (error) {
    // RAW-WEB: fixed copy plus a reference, never gateway or server text.
    return {
      status: 'error',
      message: genericActionErrorMessage(error, 'Failed to create vaccination'),
    };
  }
}

export async function createNurseIncidentAction(
  input: CreateNurseIncidentInput,
): Promise<HealthActionState> {
  try {
    const row = await createNurseIncident(input);
    revalidatePath('/health/incidents');
    return { status: 'success', message: 'Incident recorded.', sessionId: row.id };
  } catch (error) {
    // RAW-WEB: fixed copy plus a reference, never gateway or server text.
    return {
      status: 'error',
      message: genericActionErrorMessage(error, 'Failed to create incident'),
    };
  }
}
