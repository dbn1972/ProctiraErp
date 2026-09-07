'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import {
  createHostel,
  createHostelAssignment,
  createHostelBed,
  createHostelBlock,
  createHostelLeave,
  createHostelRoom,
  createHostelVisitor,
  type CreateHostelInput,
} from '@/lib/api/hostel';
import {
  checkoutLibraryItem,
  createLibraryItem,
  getLibraryClearance,
  returnLibraryLoan,
  type CreateLibraryItemInput,
} from '@/lib/api/library';

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
  try {
    const loan = await checkoutLibraryItem(input);
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

export async function createHostelAssignmentAction(input: {
  studentId: string;
  bedId: string;
  startDate: string;
  endDate?: string;
}): Promise<CampusActionState> {
  try {
    const row = await createHostelAssignment(input);
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
  try {
    const row = await createHostelLeave(input);
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

export async function createHostelVisitorAction(input: {
  hostelId: string;
  visitorName: string;
  studentId: string;
  visitDate: string;
}): Promise<CampusActionState> {
  try {
    const row = await createHostelVisitor(input);
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
