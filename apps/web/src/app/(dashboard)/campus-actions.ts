'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import { createHostel, type CreateHostelInput } from '@/lib/api/hostel';
import { createLibraryItem, type CreateLibraryItemInput } from '@/lib/api/library';

export interface CampusActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  id?: string;
}

export async function createHostelAction(input: CreateHostelInput): Promise<CampusActionState> {
  try {
    const hostel = await createHostel(input);
    revalidatePath('/hostel');
    return { status: 'success', message: 'Hostel created.', id: hostel.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to create hostel',
    };
  }
}

export async function createLibraryItemAction(
  input: CreateLibraryItemInput,
): Promise<CampusActionState> {
  try {
    const item = await createLibraryItem(input);
    revalidatePath('/library');
    return { status: 'success', message: 'Catalog item created.', id: item.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to create library item',
    };
  }
}
