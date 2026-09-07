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
