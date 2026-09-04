import type {
  HostelEntity,
  HostelRoomEntity,
  HostelAllocationEntity,
  HostelRepository,
} from './hostel-repository.js';

export class InMemoryHostelRepository implements HostelRepository {
  private readonly hostels = new Map<string, HostelEntity>();
  private readonly hostelRooms = new Map<string, HostelRoomEntity>();
  private readonly hostelAllocations = new Map<string, HostelAllocationEntity>();

  async listHostels(tenantId: string) {
    return [...this.hostels.values()].filter((x) => x.tenantId === tenantId);
  }
  async getHostel(tenantId: string, id: string) {
    const row = this.hostels.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createHostel(row: HostelEntity) {
    this.hostels.set(row.id, row);
    return row;
  }
  async updateHostel(tenantId: string, id: string, patch: Partial<HostelEntity>) {
    const cur = await this.getHostel(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.hostels.set(id, next);
    return next;
  }
  async listHostelRooms(tenantId: string) {
    return [...this.hostelRooms.values()].filter((x) => x.tenantId === tenantId);
  }
  async getHostelRoom(tenantId: string, id: string) {
    const row = this.hostelRooms.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createHostelRoom(row: HostelRoomEntity) {
    this.hostelRooms.set(row.id, row);
    return row;
  }
  async updateHostelRoom(tenantId: string, id: string, patch: Partial<HostelRoomEntity>) {
    const cur = await this.getHostelRoom(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.hostelRooms.set(id, next);
    return next;
  }
  async listHostelAllocations(tenantId: string) {
    return [...this.hostelAllocations.values()].filter((x) => x.tenantId === tenantId);
  }
  async getHostelAllocation(tenantId: string, id: string) {
    const row = this.hostelAllocations.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async createHostelAllocation(row: HostelAllocationEntity) {
    this.hostelAllocations.set(row.id, row);
    return row;
  }
  async updateHostelAllocation(tenantId: string, id: string, patch: Partial<HostelAllocationEntity>) {
    const cur = await this.getHostelAllocation(tenantId, id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };
    this.hostelAllocations.set(id, next);
    return next;
  }
}
