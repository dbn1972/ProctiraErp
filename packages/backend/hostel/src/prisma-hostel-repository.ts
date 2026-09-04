import type { PrismaClient } from '@proctira/database';
import type {
  HostelEntity,
  HostelRoomEntity,
  HostelAllocationEntity,
  HostelRepository,
} from './hostel-repository.js';

function iso(v: Date | string) {
  return v instanceof Date ? v.toISOString() : v;
}

export class PrismaHostelRepository implements HostelRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listHostels(tenantId: string) {
    const rows = await (this.prisma as any).hostel.findMany({ where: { tenantId } });
    return rows.map(mapHostel);
  }
  async getHostel(tenantId: string, id: string) {
    const row = await (this.prisma as any).hostel.findFirst({ where: { id, tenantId } });
    return row ? mapHostel(row) : null;
  }
  async createHostel(row: HostelEntity) {
    const created = await (this.prisma as any).hostel.create({ data: toHostel(row) });
    return mapHostel(created);
  }
  async updateHostel(tenantId: string, id: string, patch: Partial<HostelEntity>) {
    const existing = await this.getHostel(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).hostel.update({
      where: { id },
      data: toHostel({ ...existing, ...patch, id, tenantId }),
    });
    return mapHostel(updated);
  }
  async listHostelRooms(tenantId: string) {
    const rows = await (this.prisma as any).hostelRoom.findMany({ where: { tenantId } });
    return rows.map(mapHostelRoom);
  }
  async getHostelRoom(tenantId: string, id: string) {
    const row = await (this.prisma as any).hostelRoom.findFirst({ where: { id, tenantId } });
    return row ? mapHostelRoom(row) : null;
  }
  async createHostelRoom(row: HostelRoomEntity) {
    const created = await (this.prisma as any).hostelRoom.create({ data: toHostelRoom(row) });
    return mapHostelRoom(created);
  }
  async updateHostelRoom(tenantId: string, id: string, patch: Partial<HostelRoomEntity>) {
    const existing = await this.getHostelRoom(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).hostelRoom.update({
      where: { id },
      data: toHostelRoom({ ...existing, ...patch, id, tenantId }),
    });
    return mapHostelRoom(updated);
  }
  async listHostelAllocations(tenantId: string) {
    const rows = await (this.prisma as any).hostelAllocation.findMany({ where: { tenantId } });
    return rows.map(mapHostelAllocation);
  }
  async getHostelAllocation(tenantId: string, id: string) {
    const row = await (this.prisma as any).hostelAllocation.findFirst({ where: { id, tenantId } });
    return row ? mapHostelAllocation(row) : null;
  }
  async createHostelAllocation(row: HostelAllocationEntity) {
    const created = await (this.prisma as any).hostelAllocation.create({ data: toHostelAllocation(row) });
    return mapHostelAllocation(created);
  }
  async updateHostelAllocation(tenantId: string, id: string, patch: Partial<HostelAllocationEntity>) {
    const existing = await this.getHostelAllocation(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).hostelAllocation.update({
      where: { id },
      data: toHostelAllocation({ ...existing, ...patch, id, tenantId }),
    });
    return mapHostelAllocation(updated);
  }
}

function mapHostel(row: any): HostelEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    institutionId: row.institutionId,
    name: row.name,
    gender: row.gender,
    capacity: row.capacity,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toHostel(row: HostelEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    institutionId: row.institutionId,
    name: row.name,
    gender: row.gender,
    capacity: row.capacity,
    status: row.status,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
function mapHostelRoom(row: any): HostelRoomEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    hostelId: row.hostelId,
    name: row.name,
    beds: row.beds,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toHostelRoom(row: HostelRoomEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    hostelId: row.hostelId,
    name: row.name,
    beds: row.beds,
    status: row.status,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
function mapHostelAllocation(row: any): HostelAllocationEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    hostelId: row.hostelId,
    roomId: row.roomId,
    studentId: row.studentId,
    startDate: row.startDate,
    endDate: row.endDate ?? null,
    feeInvoiceId: row.feeInvoiceId ?? null,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toHostelAllocation(row: HostelAllocationEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    hostelId: row.hostelId,
    roomId: row.roomId,
    studentId: row.studentId,
    startDate: row.startDate,
    endDate: row.endDate ?? null,
    feeInvoiceId: row.feeInvoiceId ?? null,
    status: row.status,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
