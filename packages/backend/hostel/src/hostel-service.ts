import { randomUUID } from 'node:crypto';
import type {
  HostelEntity,
  HostelRoomEntity,
  HostelAllocationEntity,
  HostelRepository,
} from './hostel-repository.js';

export class HostelService {
  constructor(private readonly repo: HostelRepository) {}

  listHostels(tenantId: string) {
    return this.repo.listHostels(tenantId);
  }
  getHostel(tenantId: string, id: string) {
    return this.repo.getHostel(tenantId, id);
  }
  createHostel(
    tenantId: string,
    input: Omit<HostelEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createHostel({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as HostelEntity);
  }
  updateHostel(tenantId: string, id: string, patch: Partial<HostelEntity>) {
    return this.repo.updateHostel(tenantId, id, patch);
  }
  listHostelRooms(tenantId: string) {
    return this.repo.listHostelRooms(tenantId);
  }
  getHostelRoom(tenantId: string, id: string) {
    return this.repo.getHostelRoom(tenantId, id);
  }
  createHostelRoom(
    tenantId: string,
    input: Omit<HostelRoomEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createHostelRoom({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as HostelRoomEntity);
  }
  updateHostelRoom(tenantId: string, id: string, patch: Partial<HostelRoomEntity>) {
    return this.repo.updateHostelRoom(tenantId, id, patch);
  }
  listHostelAllocations(tenantId: string) {
    return this.repo.listHostelAllocations(tenantId);
  }
  getHostelAllocation(tenantId: string, id: string) {
    return this.repo.getHostelAllocation(tenantId, id);
  }
  createHostelAllocation(
    tenantId: string,
    input: Omit<HostelAllocationEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createHostelAllocation({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as HostelAllocationEntity);
  }
  updateHostelAllocation(tenantId: string, id: string, patch: Partial<HostelAllocationEntity>) {
    return this.repo.updateHostelAllocation(tenantId, id, patch);
  }
}
