'use server';

/**
 * Server Actions for Health redesign write paths.
 */
import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
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
    const message =
      error instanceof GatewayError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to create counselling session';
    return { status: 'error', message };
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
    const message =
      error instanceof GatewayError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to create allergy';
    return { status: 'error', message };
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
    const message =
      error instanceof GatewayError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to create vaccination';
    return { status: 'error', message };
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
    const message =
      error instanceof GatewayError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to create incident';
    return { status: 'error', message };
  }
}
