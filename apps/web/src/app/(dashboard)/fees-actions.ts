'use server';

import { revalidatePath } from 'next/cache';
import { parseActionInput } from '@/lib/validation/server-action-input';
import { feePlanInputSchema, invoiceInputSchema } from '@/lib/validation/dashboard-action-schemas';

import { GatewayError } from '@/lib/api/gateway';
import {
  createFeePlan,
  createInvoice,
  type CreateFeePlanInput,
  type CreateInvoiceInput,
} from '@/lib/api/fees';

export interface FeesActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  id?: string;
}

export async function createFeePlanAction(input: CreateFeePlanInput): Promise<FeesActionState> {
  const parsed = parseActionInput(feePlanInputSchema, input);
  if (!parsed.ok) return { status: 'error', message: parsed.message };
  input = parsed.data;
  try {
    const plan = await createFeePlan(input);
    revalidatePath('/fees');
    revalidatePath('/fees/plans');
    return { status: 'success', message: 'Fee plan created.', id: plan.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to create fee plan',
    };
  }
}

export async function createInvoiceAction(input: CreateInvoiceInput): Promise<FeesActionState> {
  const parsed = parseActionInput(invoiceInputSchema, input);
  if (!parsed.ok) return { status: 'error', message: parsed.message };
  input = parsed.data;
  try {
    const invoice = await createInvoice(input);
    revalidatePath('/fees');
    revalidatePath('/fees/invoices');
    revalidatePath('/parent/fees');
    return { status: 'success', message: 'Invoice issued.', id: invoice.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to create invoice',
    };
  }
}
