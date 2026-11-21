'use server';

import { revalidatePath } from 'next/cache';

import {
  createFeePlan,
  createInvoice,
  type CreateFeePlanInput,
  type CreateInvoiceInput,
} from '@/lib/api/fees';
import { genericActionErrorMessage } from '@/lib/api/action-error';

export interface FeesActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  id?: string;
}

export async function createFeePlanAction(input: CreateFeePlanInput): Promise<FeesActionState> {
  try {
    const plan = await createFeePlan(input);
    revalidatePath('/fees');
    revalidatePath('/fees/plans');
    return { status: 'success', message: 'Fee plan created.', id: plan.id };
  } catch (error) {
    return {
      status: 'error',
      message: genericActionErrorMessage(error, 'Failed to create fee plan'),
    };
  }
}

export async function createInvoiceAction(input: CreateInvoiceInput): Promise<FeesActionState> {
  try {
    const invoice = await createInvoice(input);
    revalidatePath('/fees');
    revalidatePath('/fees/invoices');
    revalidatePath('/parent/fees');
    return { status: 'success', message: 'Invoice issued.', id: invoice.id };
  } catch (error) {
    return {
      status: 'error',
      message: genericActionErrorMessage(error, 'Failed to create invoice'),
    };
  }
}
