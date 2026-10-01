'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError, gatewayFetch } from '@/lib/api/gateway';
import {
  createRoomSchema,
  firstIssue,
  repairRequestSchema,
  updateFacilitySchema,
} from '@/lib/validation/campus-actions-schema';

export async function logRepairRequestAction(input: {
  institutionId: string;
  infrastructureId: string;
  summary: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // PRC-L241: uuid ids + bounded summary before the gateway call.
  const v = repairRequestSchema.safeParse(input);
  if (!v.success) return { ok: false, error: firstIssue(v.error) };
  const { summary } = v.data;
  try {
    const result = await gatewayFetch<{ id: string }>('/infrastructure/repair-requests', {
      method: 'POST',
      json: {
        institutionId: v.data.institutionId,
        infrastructureId: v.data.infrastructureId,
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
  const v = createRoomSchema.safeParse(input);
  if (!v.success) return { ok: false, error: firstIssue(v.error) };
  try {
    const result = await gatewayFetch('/infrastructure/rooms', {
      method: 'POST',
      json: v.data,
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
  const v = updateFacilitySchema.safeParse(input);
  if (!v.success) return { ok: false, error: firstIssue(v.error) };
  try {
    const result = await gatewayFetch(`/infrastructure/${encodeURIComponent(v.data.id)}`, {
      method: 'PUT',
      json: { name: v.data.name, capacity: v.data.capacity, condition: v.data.condition },
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
