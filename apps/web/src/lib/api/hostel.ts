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
