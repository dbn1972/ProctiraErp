'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError, gatewayFetch } from '@/lib/api/gateway';

export async function logRepairRequestAction(input: {
  institutionId: string;
  infrastructureId: string;
  summary: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const summary = input.summary.trim();
  if (!summary) return { ok: false, error: 'Describe the repair before submitting.' };
  try {
    const result = await gatewayFetch<{ id: string }>('/infrastructure/repair-requests', {
      method: 'POST',
      json: {
        institutionId: input.institutionId,
        infrastructureId: input.infrastructureId,
        summary,
      },
      cache: 'no-store',
      throwOnError: false,
    });
    if (!result.ok || !result.data) {
      return {
        ok: false,
        error: result.error?.message ?? 'The repair request could not be saved.',
      };
    }
    revalidatePath(`/institutions/${input.institutionId}/infrastructure`);
    return { ok: true, id: result.data.id };
  } catch (error) {
    if (error instanceof GatewayError) return { ok: false, error: error.message };
    return { ok: false, error: 'The repair request could not be saved.' };
  }
}

export async function createRoomAction(input: {
  institutionId: string;
  floorId: string;
  name: string;
  capacity: number;
  condition: 'Good' | 'Fair' | 'Needs repair' | 'Unknown';
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const result = await gatewayFetch('/infrastructure/rooms', {
      method: 'POST',
      json: input,
      throwOnError: false,
      cache: 'no-store',
    });
    if (!result.ok) {
      return { ok: false, error: result.error?.message ?? 'Could not add the room.' };
    }
    revalidatePath(`/institutions/${input.institutionId}/infrastructure`);
    return { ok: true };
  } catch (error) {
    if (error instanceof GatewayError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not add the room.' };
  }
}

export async function updateFacilityAction(input: {
  institutionId: string;
  id: string;
  name: string;
  capacity: number;
  condition: 'Good' | 'Fair' | 'Needs repair' | 'Unknown';
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const result = await gatewayFetch(`/infrastructure/${input.id}`, {
      method: 'PUT',
      json: { name: input.name, capacity: input.capacity, condition: input.condition },
      throwOnError: false,
      cache: 'no-store',
    });
    if (!result.ok) {
      return { ok: false, error: result.error?.message ?? 'Could not update the facility.' };
    }
    revalidatePath(`/institutions/${input.institutionId}/infrastructure`);
    return { ok: true };
  } catch (error) {
    if (error instanceof GatewayError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not update the facility.' };
  }
}
