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
import {
  INVALID_ID_MESSAGE,
  areValidActionIds,
  firstIssue,
  hostelAssignmentInputSchema,
  hostelLeaveInputSchema,
  hostelVisitorInputSchema,
  libraryCheckoutInputSchema,
} from '@/lib/validation/campus-action-schema';

export interface CampusActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  id?: string;
  clear?: boolean;
  openLoanCount?: number;
  overdueCount?: number;
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
  try {
    const clearance = await getLibraryClearance(studentId);
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
    return { status: 'error', message: firstIssue(parsed.error, 'Checkout fields are invalid.') };
  }
  try {
    // PRC-L047: the form sends a wall-clock date; resolve in tenant TZ.
    // Validated input (PRC-L033) is what reaches the gateway.
    const dueAt = await toTenantUtcIso(parsed.data.dueAt);
    const loan = await checkoutLibraryItem({ ...parsed.data, dueAt });
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
  try {
    const loan = await returnLibraryLoan(loanId);
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
  try {
    const loan = await renewLibraryLoan(loanId, extendDays);
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
    return { status: 'error', message: firstIssue(parsed.error, 'Assignment fields are invalid.') };
  }
  try {
    const row = await createHostelAssignment(parsed.data);
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
    return { status: 'error', message: firstIssue(parsed.error, 'Leave fields are invalid.') };
  }
  try {
    const row = await createHostelLeave(parsed.data);
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
  try {
    const row = await decideHostelLeave(id, status);
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
  try {
    const row = await updateHostelVisitorStatus(id, status);
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
    return { status: 'error', message: firstIssue(parsed.error, 'Visitor fields are invalid.') };
  }
  try {
    const row = await createHostelVisitor(parsed.data);
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
  try {
    const row = await createHostelBlock(input);
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
  try {
    const row = await createHostelRoom(input);
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
  try {
    const row = await createHostelBed(input);
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
