'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import { toTenantUtcIso } from '@/lib/datetime/tenant-timezone.server';
import {
  createHostel,
  createHostelAssignment,
  createHostelBed,
  createHostelBlock,
  createHostelLeave,
  createHostelRoom,
  createHostelVisitor,
  decideHostelLeave,
  updateHostelVisitorStatus,
  type CreateHostelInput,
} from '@/lib/api/hostel';
import {
  checkoutLibraryItem,
  createLibraryItem,
  getLibraryClearance,
  renewLibraryLoan,
  returnLibraryLoan,
  type CreateLibraryItemInput,
} from '@/lib/api/library';
// PRC-L033 (#513) and PRC-L241 (#529) boundary checks both apply.
import {
  INVALID_ID_MESSAGE,
  areValidActionIds,
  firstIssue as firstActionIssue,
  hostelAssignmentInputSchema,
  hostelLeaveInputSchema,
  hostelVisitorInputSchema,
  libraryCheckoutInputSchema,
} from '@/lib/validation/campus-action-schema';

import {
  checkoutSchema,
  createHostelSchema,
  createLibraryItemSchema,
  decideLeaveSchema,
  firstIssue,
  hostelAssignmentSchema,
  hostelBedSchema,
  hostelBlockSchema,
  hostelLeaveSchema,
  hostelRoomSchema,
  hostelVisitorSchema,
  renewSchema,
  uuid,
  visitorStatusSchema,
} from '@/lib/validation/campus-actions-schema';
import type { ZodError } from 'zod';

export interface CampusActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  id?: string;
  clear?: boolean;
  openLoanCount?: number;
  overdueCount?: number;
}

/** PRC-L241: every action validates before any gateway request. */
function invalid(error: ZodError): CampusActionState {
  return { status: 'error', message: firstIssue(error) };
}

export async function createHostelAction(input: CreateHostelInput): Promise<CampusActionState> {
  const v = createHostelSchema.safeParse(input);
  if (!v.success) return invalid(v.error);
  try {
    const hostel = await createHostel(v.data);
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
  const v = createLibraryItemSchema.safeParse(input);
  if (!v.success) return invalid(v.error);
  try {
    const item = await createLibraryItem(v.data);
    revalidatePath('/library');
    revalidatePath('/library/circulation');
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

export async function checkLibraryClearanceAction(studentId: string): Promise<CampusActionState> {
  if (!areValidActionIds(studentId)) return { status: 'error', message: INVALID_ID_MESSAGE };
  const v = uuid.safeParse(studentId);
  if (!v.success) return invalid(v.error);
  try {
    const clearance = await getLibraryClearance(v.data);
    return {
      status: 'success',
      message: clearance.clear
        ? 'Library clear — no open loans.'
        : `Not clear — ${clearance.openLoanCount} open loan(s)` +
          (clearance.overdueCount ? ` (${clearance.overdueCount} overdue)` : '') +
          '.',
      clear: clearance.clear,
      openLoanCount: clearance.openLoanCount,
      overdueCount: clearance.overdueCount,
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to check library clearance',
    };
  }
}

export async function checkoutLibraryItemAction(input: {
  itemId: string;
  patronUserId?: string;
  studentId?: string;
  dueAt?: string;
}): Promise<CampusActionState> {
  const parsed = libraryCheckoutInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: firstActionIssue(parsed.error, 'Checkout fields are invalid.'),
    };
  }
  const v = checkoutSchema.safeParse(parsed.data);
  if (!v.success) return invalid(v.error);
  try {
    // PRC-L047: the form sends a wall-clock date; resolve in tenant TZ.
    // Input validated by both L033 and L241 schemas is what reaches the gateway.
    const dueAt = await toTenantUtcIso(v.data.dueAt);
    const loan = await checkoutLibraryItem({ ...v.data, dueAt });
    revalidatePath('/library');
    revalidatePath('/library/circulation');
    revalidatePath('/library/overdues');
    return { status: 'success', message: 'Checked out.', id: loan.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Checkout failed',
    };
  }
}

export async function returnLibraryLoanAction(loanId: string): Promise<CampusActionState> {
  if (!areValidActionIds(loanId)) return { status: 'error', message: INVALID_ID_MESSAGE };
  const v = uuid.safeParse(loanId);
  if (!v.success) return invalid(v.error);
  try {
    const loan = await returnLibraryLoan(v.data);
    revalidatePath('/library');
    revalidatePath('/library/circulation');
    revalidatePath('/library/overdues');
    return { status: 'success', message: 'Returned.', id: loan.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Return failed',
    };
  }
}

export async function renewLibraryLoanAction(
  loanId: string,
  extendDays?: number,
): Promise<CampusActionState> {
  if (!areValidActionIds(loanId)) return { status: 'error', message: INVALID_ID_MESSAGE };
  if (
    extendDays !== undefined &&
    (!Number.isInteger(extendDays) || extendDays < 1 || extendDays > 365)
  ) {
    return { status: 'error', message: 'Extend days must be a whole number between 1 and 365.' };
  }
  const v = renewSchema.safeParse({ loanId, extendDays });
  if (!v.success) return invalid(v.error);
  try {
    const loan = await renewLibraryLoan(v.data.loanId, v.data.extendDays);
    revalidatePath('/library');
    revalidatePath('/library/circulation');
    revalidatePath('/library/overdues');
    return { status: 'success', message: `Renewed — due ${loan.dueAt}.`, id: loan.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Renew failed',
    };
  }
}

export async function createHostelAssignmentAction(input: {
  studentId: string;
  bedId: string;
  startDate: string;
  endDate?: string;
  feeStructureId?: string;
}): Promise<CampusActionState> {
  const parsed = hostelAssignmentInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: firstActionIssue(parsed.error, 'Assignment fields are invalid.'),
    };
  }
  const v = hostelAssignmentSchema.safeParse(parsed.data);
  if (!v.success) return invalid(v.error);
  try {
    const row = await createHostelAssignment(v.data);
    revalidatePath('/hostel');
    revalidatePath('/hostel/assignments');
    return { status: 'success', message: 'Assignment created.', id: row.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to create assignment',
    };
  }
}

export async function createHostelLeaveAction(input: {
  studentId: string;
  hostelId: string;
  startDate: string;
  endDate: string;
  reason?: string;
}): Promise<CampusActionState> {
  const parsed = hostelLeaveInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: firstActionIssue(parsed.error, 'Leave fields are invalid.'),
    };
  }
  const v = hostelLeaveSchema.safeParse(parsed.data);
  if (!v.success) return invalid(v.error);
  try {
    const row = await createHostelLeave(v.data);
    revalidatePath('/hostel/leaves');
    return { status: 'success', message: 'Leave recorded.', id: row.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to create leave',
    };
  }
}

export async function decideHostelLeaveAction(
  id: string,
  status: 'approved' | 'rejected',
): Promise<CampusActionState> {
  if (!areValidActionIds(id) || (status !== 'approved' && status !== 'rejected'))
    return { status: 'error', message: INVALID_ID_MESSAGE };
  const v = decideLeaveSchema.safeParse({ id, status });
  if (!v.success) return invalid(v.error);
  try {
    const row = await decideHostelLeave(v.data.id, v.data.status);
    revalidatePath('/hostel/leaves');
    return {
      status: 'success',
      message: status === 'approved' ? 'Leave approved.' : 'Leave rejected.',
      id: row.id,
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to decide leave',
    };
  }
}

export async function updateHostelVisitorStatusAction(
  id: string,
  status: 'checked_in' | 'checked_out' | 'denied',
): Promise<CampusActionState> {
  if (!areValidActionIds(id) || !['checked_in', 'checked_out', 'denied'].includes(status)) {
    return { status: 'error', message: INVALID_ID_MESSAGE };
  }
  const v = visitorStatusSchema.safeParse({ id, status });
  if (!v.success) return invalid(v.error);
  try {
    const row = await updateHostelVisitorStatus(v.data.id, v.data.status);
    revalidatePath('/hostel/visitors');
    return {
      status: 'success',
      message: `Visitor marked ${status.replace('_', ' ')}.`,
      id: row.id,
    };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to update visitor status',
    };
  }
}

export async function createHostelVisitorAction(input: {
  hostelId: string;
  visitorName: string;
  studentId: string;
  visitDate: string;
}): Promise<CampusActionState> {
  const parsed = hostelVisitorInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: firstActionIssue(parsed.error, 'Visitor fields are invalid.'),
    };
  }
  const v = hostelVisitorSchema.safeParse(parsed.data);
  if (!v.success) return invalid(v.error);
  try {
    const row = await createHostelVisitor(v.data);
    revalidatePath('/hostel/visitors');
    return { status: 'success', message: 'Visitor recorded.', id: row.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to create visitor',
    };
  }
}

export async function createHostelBlockAction(input: {
  hostelId: string;
  name: string;
  floor?: number;
}): Promise<CampusActionState> {
  if (!areValidActionIds(input.hostelId)) return { status: 'error', message: INVALID_ID_MESSAGE };
  const v = hostelBlockSchema.safeParse(input);
  if (!v.success) return invalid(v.error);
  try {
    const row = await createHostelBlock(v.data);
    revalidatePath('/hostel');
    revalidatePath('/hostel/structure');
    return { status: 'success', message: 'Block created.', id: row.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to create block',
    };
  }
}

export async function createHostelRoomAction(input: {
  blockId: string;
  roomNumber: string;
  capacity?: number;
}): Promise<CampusActionState> {
  if (!areValidActionIds(input.blockId)) return { status: 'error', message: INVALID_ID_MESSAGE };
  const v = hostelRoomSchema.safeParse(input);
  if (!v.success) return invalid(v.error);
  try {
    const row = await createHostelRoom(v.data);
    revalidatePath('/hostel');
    revalidatePath('/hostel/structure');
    return { status: 'success', message: 'Room created.', id: row.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to create room',
    };
  }
}

export async function createHostelBedAction(input: {
  roomId: string;
  bedLabel: string;
  isAvailable?: boolean;
}): Promise<CampusActionState> {
  if (!areValidActionIds(input.roomId)) return { status: 'error', message: INVALID_ID_MESSAGE };
  const v = hostelBedSchema.safeParse(input);
  if (!v.success) return invalid(v.error);
  try {
    const row = await createHostelBed(v.data);
    revalidatePath('/hostel');
    revalidatePath('/hostel/structure');
    revalidatePath('/hostel/assignments');
    return { status: 'success', message: 'Bed created.', id: row.id };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof GatewayError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Failed to create bed',
    };
  }
}
