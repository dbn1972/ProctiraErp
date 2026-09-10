'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { GatewayError } from '@/lib/api/gateway';
import {
  addHostelMessMenuItem,
  createHostelFeeStructure,
  createHostelGatePass,
  createHostelMessPlan,
  subscribeHostelMess,
  transitionHostelGatePass,
  upsertHostelAttendance,
} from '@/lib/api/hostel';
import {
  assessLibraryFine,
  checkoutLibraryByBarcode,
  importLibraryIsbn,
  lookupIsbn,
  payLibraryFine,
  placeLibraryHold,
  returnLibraryByBarcode,
} from '@/lib/api/library';

export interface OpsActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  id?: string;
  title?: string;
  author?: string;
  isbn?: string;
}

const UUID = z.string().uuid();

function fail(error: unknown, fallback: string): OpsActionState {
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

export async function lookupIsbnFillAction(isbn: string): Promise<OpsActionState> {
  const parsed = z.string().min(10).max(32).safeParse(isbn);
  if (!parsed.success) return { status: 'error', message: 'ISBN must be 10–32 characters.' };
  try {
    const meta = await lookupIsbn(parsed.data);
    if (!meta) return { status: 'error', message: 'ISBN not found in the catalog.' };
    return {
      status: 'success',
      title: meta.title,
      author: meta.author ?? undefined,
      isbn: meta.isbn,
      message: `Found ${meta.title}.`,
    };
  } catch (error) {
    return fail(error, 'ISBN lookup failed');
  }
}

export async function importIsbnAction(input: {
  isbn: string;
  copies?: number;
}): Promise<OpsActionState> {
  const parsed = z
    .object({ isbn: z.string().min(10).max(32), copies: z.number().int().min(1).optional() })
    .safeParse(input);
  if (!parsed.success) return { status: 'error', message: 'ISBN must be 10–32 characters.' };
  try {
    const item = await importLibraryIsbn(parsed.data.isbn, parsed.data.copies);
    revalidatePath('/library');
    revalidatePath('/library/circulation');
    return { status: 'success', id: item.id, message: `Imported ${item.title}.` };
  } catch (error) {
    return fail(error, 'ISBN import failed');
  }
}

export async function placeHoldAction(input: {
  itemId: string;
  studentId?: string;
  patronUserId?: string;
}): Promise<OpsActionState> {
  const parsed = z
    .object({
      itemId: UUID,
      studentId: z.string().min(1).max(128).optional(),
      patronUserId: z.string().min(1).max(128).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { status: 'error', message: 'A valid item id is required.' };
  try {
    const hold = await placeLibraryHold(parsed.data);
    revalidatePath('/library');
    revalidatePath('/library/holds');
    return { status: 'success', id: hold.id, message: `Hold queued at position ${hold.position}.` };
  } catch (error) {
    return fail(error, 'Hold failed');
  }
}

export async function checkoutBarcodeAction(input: {
  barcode: string;
  patronUserId?: string;
  studentId?: string;
}): Promise<OpsActionState> {
  const parsed = z
    .object({
      barcode: z.string().min(1).max(64),
      patronUserId: z.string().min(1).max(128).optional(),
      studentId: z.string().min(1).max(128).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { status: 'error', message: 'Barcode is required.' };
  try {
    const loan = await checkoutLibraryByBarcode(parsed.data);
    revalidatePath('/library');
    revalidatePath('/library/circulation');
    return { status: 'success', id: loan.id, message: 'Checked out by barcode.' };
  } catch (error) {
    return fail(error, 'Barcode checkout failed');
  }
}

export async function returnBarcodeAction(barcode: string): Promise<OpsActionState> {
  const parsed = z.string().min(1).max(64).safeParse(barcode);
  if (!parsed.success) return { status: 'error', message: 'Barcode is required.' };
  try {
    const loan = await returnLibraryByBarcode(parsed.data);
    revalidatePath('/library');
    revalidatePath('/library/circulation');
    revalidatePath('/library/overdues');
    return { status: 'success', id: loan.id, message: 'Returned by barcode.' };
  } catch (error) {
    return fail(error, 'Barcode return failed');
  }
}

export async function assessFineAction(loanId: string): Promise<OpsActionState> {
  const parsed = UUID.safeParse(loanId);
  if (!parsed.success) return { status: 'error', message: 'A valid loan id is required.' };
  try {
    const assessed = await assessLibraryFine(parsed.data);
    revalidatePath('/library/overdues');
    revalidatePath('/library/fines');
    revalidatePath('/fees');
    const invoice = assessed.invoice?.id ? ` Invoice ${assessed.invoice.id}.` : '';
    return {
      status: 'success',
      id: assessed.loanId,
      message: `Fine ${assessed.amountCents} cents assessed.${invoice}`,
    };
  } catch (error) {
    return fail(error, 'Assess fine failed');
  }
}

export async function markFinePaidAction(fineId: string): Promise<OpsActionState> {
  const parsed = UUID.safeParse(fineId);
  if (!parsed.success) return { status: 'error', message: 'A valid fine id is required.' };
  try {
    const fine = await payLibraryFine(parsed.data);
    revalidatePath('/library/fines');
    revalidatePath('/library/overdues');
    return { status: 'success', id: fine.id, message: 'Fine marked paid.' };
  } catch (error) {
    return fail(error, 'Mark paid failed');
  }
}

export async function createMessPlanAction(input: {
  hostelId: string;
  name: string;
  mealCount?: number;
}): Promise<OpsActionState> {
  const parsed = z
    .object({
      hostelId: UUID,
      name: z.string().min(1).max(255),
      mealCount: z.number().int().min(1).max(6).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { status: 'error', message: 'Hostel and plan name are required.' };
  try {
    const plan = await createHostelMessPlan(parsed.data);
    revalidatePath('/hostel/mess');
    return { status: 'success', id: plan.id, message: 'Mess plan created.' };
  } catch (error) {
    return fail(error, 'Failed to create mess plan');
  }
}

export async function addMessMenuAction(input: {
  planId: string;
  weekday: number;
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snacks';
  itemName: string;
}): Promise<OpsActionState> {
  const parsed = z
    .object({
      planId: UUID,
      weekday: z.number().int().min(0).max(6),
      meal: z.enum(['breakfast', 'lunch', 'dinner', 'snacks']),
      itemName: z.string().min(1).max(255),
    })
    .safeParse(input);
  if (!parsed.success) return { status: 'error', message: 'Menu fields are invalid.' };
  try {
    const item = await addHostelMessMenuItem(parsed.data);
    revalidatePath('/hostel/mess');
    return { status: 'success', id: item.id, message: 'Menu item added.' };
  } catch (error) {
    return fail(error, 'Failed to add menu item');
  }
}

export async function subscribeMessAction(input: {
  planId: string;
  studentId: string;
  startDate: string;
}): Promise<OpsActionState> {
  const parsed = z
    .object({
      planId: UUID,
      studentId: UUID,
      startDate: z.string().min(10).max(10),
    })
    .safeParse(input);
  if (!parsed.success) return { status: 'error', message: 'Subscription fields are invalid.' };
  try {
    const sub = await subscribeHostelMess(parsed.data);
    revalidatePath('/hostel/mess');
    return { status: 'success', id: sub.id, message: 'Student subscribed.' };
  } catch (error) {
    return fail(error, 'Failed to subscribe');
  }
}

export async function requestGatePassAction(input: {
  hostelId: string;
  studentId: string;
  expectedOutAt: string;
  expectedInAt: string;
  reason?: string;
  requestedBy?: 'resident' | 'parent';
}): Promise<OpsActionState> {
  const parsed = z
    .object({
      hostelId: UUID,
      studentId: UUID,
      expectedOutAt: z.string().min(1),
      expectedInAt: z.string().min(1),
      reason: z.string().max(1000).optional(),
      requestedBy: z.enum(['resident', 'parent']).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { status: 'error', message: 'Gate pass fields are invalid.' };
  try {
    const pass = await createHostelGatePass(parsed.data);
    revalidatePath('/hostel/gate-passes');
    return { status: 'success', id: pass.id, message: 'Gate pass requested.' };
  } catch (error) {
    return fail(error, 'Failed to request gate pass');
  }
}

export async function decideGatePassAction(
  id: string,
  status: 'approved' | 'rejected',
): Promise<OpsActionState> {
  const parsed = z.object({ id: UUID, status: z.enum(['approved', 'rejected']) }).safeParse({
    id,
    status,
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid gate pass decision.' };
  try {
    const pass = await transitionHostelGatePass(parsed.data.id, parsed.data.status);
    revalidatePath('/hostel/gate-passes');
    return { status: 'success', id: pass.id, message: `Gate pass ${pass.status}.` };
  } catch (error) {
    return fail(error, 'Failed to decide gate pass');
  }
}

export async function scanGatePassAction(
  id: string,
  status: 'out' | 'in',
): Promise<OpsActionState> {
  const parsed = z.object({ id: UUID, status: z.enum(['out', 'in']) }).safeParse({ id, status });
  if (!parsed.success) return { status: 'error', message: 'Invalid gate scan.' };
  try {
    const pass = await transitionHostelGatePass(parsed.data.id, parsed.data.status);
    revalidatePath('/hostel/gate-passes');
    return { status: 'success', id: pass.id, message: `Gate pass ${pass.status}.` };
  } catch (error) {
    return fail(error, 'Failed to scan gate pass');
  }
}

export async function createHostelFeeStructureAction(input: {
  hostelId: string;
  roomType: string;
  termLabel: string;
  amountCents: number;
}): Promise<OpsActionState> {
  const parsed = z
    .object({
      hostelId: UUID,
      roomType: z.string().min(1).max(64),
      termLabel: z.string().min(1).max(64),
      amountCents: z.number().int().min(0),
    })
    .safeParse(input);
  if (!parsed.success) return { status: 'error', message: 'Fee structure fields are invalid.' };
  try {
    const row = await createHostelFeeStructure(parsed.data);
    revalidatePath('/hostel/fees');
    revalidatePath('/hostel/assignments');
    return { status: 'success', id: row.id, message: 'Hostel fee structure saved.' };
  } catch (error) {
    return fail(error, 'Failed to save fee structure');
  }
}

export async function recordHostelAttendanceAction(input: {
  blockId: string;
  studentId: string;
  onDate: string;
  status: 'present' | 'absent' | 'leave';
  reason?: string;
}): Promise<OpsActionState> {
  const parsed = z
    .object({
      blockId: UUID,
      studentId: UUID,
      onDate: z.string().min(10).max(10),
      status: z.enum(['present', 'absent', 'leave']),
      reason: z.string().max(500).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { status: 'error', message: 'Attendance fields are invalid.' };
  try {
    const mark = await upsertHostelAttendance(parsed.data);
    revalidatePath('/hostel/attendance');
    return { status: 'success', id: mark.id, message: `Marked ${mark.status}.` };
  } catch (error) {
    return fail(error, 'Failed to record attendance');
  }
}
