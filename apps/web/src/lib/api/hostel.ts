/**
 * Hostel service client.
 */
import { GatewayError, gatewayFetch } from './gateway';

export interface Hostel {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  address: string | null;
  capacity: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface HostelAssignment {
  id: string;
  tenantId: string;
  studentId: string;
  bedId: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateHostelInput {
  name: string;
  code: string;
  address?: string;
  capacity?: number;
}

export async function listHostels(): Promise<Hostel[]> {
  const result = await gatewayFetch<{ data: Hostel[] }>('/hostel', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createHostel(input: CreateHostelInput): Promise<Hostel> {
  const result = await gatewayFetch<Hostel>('/hostel', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create hostel',
    });
  }
  return result.data;
}

export async function listHostelAssignments(): Promise<HostelAssignment[]> {
  const result = await gatewayFetch<{ data: HostelAssignment[] }>('/hostel/assignments', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createHostelAssignment(input: {
  studentId: string;
  bedId: string;
  startDate: string;
  endDate?: string;
  isActive?: boolean;
  feeStructureId?: string;
}): Promise<HostelAssignment> {
  const result = await gatewayFetch<HostelAssignment>('/hostel/assignments', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create hostel assignment',
    });
  }
  return result.data;
}

export interface HostelLeave {
  id: string;
  tenantId: string;
  studentId: string;
  hostelId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface HostelVisitor {
  id: string;
  tenantId: string;
  hostelId: string;
  visitorName: string;
  studentId: string;
  visitDate: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export async function listHostelLeaves(): Promise<HostelLeave[]> {
  const result = await gatewayFetch<{ data: HostelLeave[] }>('/hostel/leaves', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createHostelLeave(input: {
  studentId: string;
  hostelId: string;
  startDate: string;
  endDate: string;
  reason?: string;
}): Promise<HostelLeave> {
  const result = await gatewayFetch<HostelLeave>('/hostel/leaves', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create leave',
    });
  }
  return result.data;
}

export async function decideHostelLeave(
  id: string,
  status: 'approved' | 'rejected',
): Promise<HostelLeave> {
  const result = await gatewayFetch<HostelLeave>(`/hostel/leaves/${id}/decide`, {
    method: 'POST',
    json: { status },
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'DECIDE_FAILED',
      message: result.error?.message ?? 'Failed to decide leave',
    });
  }
  return result.data;
}

export async function updateHostelVisitorStatus(
  id: string,
  status: 'checked_in' | 'checked_out' | 'denied',
): Promise<HostelVisitor> {
  const result = await gatewayFetch<HostelVisitor>(`/hostel/visitors/${id}/status`, {
    method: 'POST',
    json: { status },
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'STATUS_FAILED',
      message: result.error?.message ?? 'Failed to update visitor status',
    });
  }
  return result.data;
}

export async function listHostelVisitors(): Promise<HostelVisitor[]> {
  const result = await gatewayFetch<{ data: HostelVisitor[] }>('/hostel/visitors', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createHostelVisitor(input: {
  hostelId: string;
  visitorName: string;
  studentId: string;
  visitDate: string;
}): Promise<HostelVisitor> {
  const result = await gatewayFetch<HostelVisitor>('/hostel/visitors', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create visitor',
    });
  }
  return result.data;
}

export interface HostelBlock {
  id: string;
  tenantId: string;
  hostelId: string;
  name: string;
  floor: number;
  createdAt: string;
  updatedAt: string;
}

export interface HostelRoom {
  id: string;
  tenantId: string;
  blockId: string;
  roomNumber: string;
  capacity: number;
  createdAt: string;
  updatedAt: string;
}

export interface HostelBed {
  id: string;
  tenantId: string;
  roomId: string;
  bedLabel: string;
  isAvailable: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listHostelBlocks(hostelId?: string): Promise<HostelBlock[]> {
  const query = hostelId ? `?hostelId=${encodeURIComponent(hostelId)}` : '';
  const result = await gatewayFetch<{ data: HostelBlock[] }>(`/hostel/blocks${query}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createHostelBlock(input: {
  hostelId: string;
  name: string;
  floor?: number;
}): Promise<HostelBlock> {
  const result = await gatewayFetch<HostelBlock>('/hostel/blocks', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create block',
    });
  }
  return result.data;
}

export async function listHostelRooms(blockId?: string): Promise<HostelRoom[]> {
  const query = blockId ? `?blockId=${encodeURIComponent(blockId)}` : '';
  const result = await gatewayFetch<{ data: HostelRoom[] }>(`/hostel/rooms${query}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createHostelRoom(input: {
  blockId: string;
  roomNumber: string;
  capacity?: number;
}): Promise<HostelRoom> {
  const result = await gatewayFetch<HostelRoom>('/hostel/rooms', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create room',
    });
  }
  return result.data;
}

export async function listHostelBeds(roomId?: string): Promise<HostelBed[]> {
  const query = roomId ? `?roomId=${encodeURIComponent(roomId)}` : '';
  const result = await gatewayFetch<{ data: HostelBed[] }>(`/hostel/beds${query}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createHostelBed(input: {
  roomId: string;
  bedLabel: string;
  isAvailable?: boolean;
}): Promise<HostelBed> {
  const result = await gatewayFetch<HostelBed>('/hostel/beds', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create bed',
    });
  }
  return result.data;
}

export interface HostelMessPlan {
  id: string;
  tenantId: string;
  hostelId: string;
  name: string;
  mealCount: number;
  status: string;
}

export interface HostelMessMenuItem {
  id: string;
  planId: string;
  weekday: number;
  meal: string;
  itemName: string;
}

export interface HostelMessSubscription {
  id: string;
  planId: string;
  studentId: string;
  startDate: string;
  endDate: string | null;
  status: string;
}

export interface HostelGatePass {
  id: string;
  tenantId: string;
  hostelId: string;
  studentId: string;
  reason: string | null;
  expectedOutAt: string;
  expectedInAt: string;
  status: string;
  decidedBy: string | null;
  overdueReturn?: boolean;
}

export interface HostelFeeStructure {
  id: string;
  hostelId: string;
  roomType: string;
  termLabel: string;
  amountCents: number;
  currency: string;
}

export interface HostelAttendanceMark {
  id: string;
  blockId: string;
  studentId: string;
  onDate: string;
  status: string;
  reason: string | null;
}

export async function listHostelMessPlans(hostelId?: string): Promise<HostelMessPlan[]> {
  const query = hostelId ? `?hostelId=${encodeURIComponent(hostelId)}` : '';
  const result = await gatewayFetch<{ data: HostelMessPlan[] }>(`/hostel/mess/plans${query}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function listHostelMessMenu(planId: string): Promise<HostelMessMenuItem[]> {
  const result = await gatewayFetch<{ data: HostelMessMenuItem[] }>(
    `/hostel/mess/menu?planId=${encodeURIComponent(planId)}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function listHostelMessSubscriptions(planId?: string): Promise<HostelMessSubscription[]> {
  const query = planId ? `?planId=${encodeURIComponent(planId)}` : '';
  const result = await gatewayFetch<{ data: HostelMessSubscription[] }>(
    `/hostel/mess/subscriptions${query}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function createHostelMessPlan(input: {
  hostelId: string;
  name: string;
  mealCount?: number;
}): Promise<HostelMessPlan> {
  const result = await gatewayFetch<HostelMessPlan>('/hostel/mess/plans', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create mess plan',
    });
  }
  return result.data;
}

export async function addHostelMessMenuItem(input: {
  planId: string;
  weekday: number;
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snacks';
  itemName: string;
}): Promise<{ id: string; itemName: string }> {
  const result = await gatewayFetch<{ id: string; itemName: string }>('/hostel/mess/menu', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to add menu item',
    });
  }
  return result.data;
}

export async function subscribeHostelMess(input: {
  planId: string;
  studentId: string;
  startDate: string;
}): Promise<{ id: string; status: string }> {
  const result = await gatewayFetch<{ id: string; status: string }>('/hostel/mess/subscriptions', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to subscribe',
    });
  }
  return result.data;
}

export async function listHostelGatePasses(hostelId?: string): Promise<HostelGatePass[]> {
  const query = hostelId ? `?hostelId=${encodeURIComponent(hostelId)}` : '';
  const result = await gatewayFetch<{ data: HostelGatePass[] }>(`/hostel/gate-passes${query}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createHostelGatePass(input: {
  hostelId: string;
  studentId: string;
  expectedOutAt: string;
  expectedInAt: string;
  reason?: string;
  requestedBy?: 'resident' | 'parent';
}): Promise<HostelGatePass> {
  const result = await gatewayFetch<HostelGatePass>('/hostel/gate-passes', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to request gate pass',
    });
  }
  return result.data;
}

export async function transitionHostelGatePass(
  id: string,
  status: 'approved' | 'rejected' | 'out' | 'in',
): Promise<HostelGatePass> {
  const path =
    status === 'approved' ? 'approve' : status === 'rejected' ? 'reject' : status;
  const result = await gatewayFetch<HostelGatePass>(`/hostel/gate-passes/${id}/${path}`, {
    method: 'POST',
    json: {},
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'DECIDE_FAILED',
      message: result.error?.message ?? 'Failed to update gate pass',
    });
  }
  return result.data;
}

export async function listHostelFeeStructures(hostelId?: string): Promise<HostelFeeStructure[]> {
  const query = hostelId ? `?hostelId=${encodeURIComponent(hostelId)}` : '';
  const result = await gatewayFetch<{ data: HostelFeeStructure[] }>(
    `/hostel/fee-structures${query}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function createHostelFeeStructure(input: {
  hostelId: string;
  roomType: string;
  termLabel: string;
  amountCents: number;
}): Promise<HostelFeeStructure> {
  const result = await gatewayFetch<HostelFeeStructure>('/hostel/fee-structures', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'CREATE_FAILED',
      message: result.error?.message ?? 'Failed to create fee structure',
    });
  }
  return result.data;
}

export async function listHostelAttendance(
  blockId: string,
  onDate: string,
): Promise<HostelAttendanceMark[]> {
  const result = await gatewayFetch<{ data: HostelAttendanceMark[] }>(
    `/hostel/attendance?blockId=${encodeURIComponent(blockId)}&onDate=${encodeURIComponent(onDate)}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function upsertHostelAttendance(input: {
  blockId: string;
  studentId: string;
  onDate: string;
  status: 'present' | 'absent' | 'leave';
  reason?: string;
}): Promise<HostelAttendanceMark> {
  const result = await gatewayFetch<HostelAttendanceMark>('/hostel/attendance', {
    method: 'PUT',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: result.error?.code ?? 'ATTENDANCE_FAILED',
      message: result.error?.message ?? 'Failed to record attendance',
    });
  }
  return result.data;
}
