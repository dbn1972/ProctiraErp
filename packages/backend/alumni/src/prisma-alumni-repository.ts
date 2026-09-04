import type { PrismaClient } from '@proctira/database';
import type {
  AlumniProfileEntity,
  AlumniEventEntity,
  AlumniRepository,
} from './alumni-repository.js';

function iso(v: Date | string) {
  return v instanceof Date ? v.toISOString() : v;
}

export class PrismaAlumniRepository implements AlumniRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listAlumniProfiles(tenantId: string) {
    const rows = await (this.prisma as any).alumniProfile.findMany({ where: { tenantId } });
    return rows.map(mapAlumniProfile);
  }
  async getAlumniProfile(tenantId: string, id: string) {
    const row = await (this.prisma as any).alumniProfile.findFirst({ where: { id, tenantId } });
    return row ? mapAlumniProfile(row) : null;
  }
  async createAlumniProfile(row: AlumniProfileEntity) {
    const created = await (this.prisma as any).alumniProfile.create({ data: toAlumniProfile(row) });
    return mapAlumniProfile(created);
  }
  async updateAlumniProfile(tenantId: string, id: string, patch: Partial<AlumniProfileEntity>) {
    const existing = await this.getAlumniProfile(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).alumniProfile.update({
      where: { id },
      data: toAlumniProfile({ ...existing, ...patch, id, tenantId }),
    });
    return mapAlumniProfile(updated);
  }
  async listAlumniEvents(tenantId: string) {
    const rows = await (this.prisma as any).alumniEvent.findMany({ where: { tenantId } });
    return rows.map(mapAlumniEvent);
  }
  async getAlumniEvent(tenantId: string, id: string) {
    const row = await (this.prisma as any).alumniEvent.findFirst({ where: { id, tenantId } });
    return row ? mapAlumniEvent(row) : null;
  }
  async createAlumniEvent(row: AlumniEventEntity) {
    const created = await (this.prisma as any).alumniEvent.create({ data: toAlumniEvent(row) });
    return mapAlumniEvent(created);
  }
  async updateAlumniEvent(tenantId: string, id: string, patch: Partial<AlumniEventEntity>) {
    const existing = await this.getAlumniEvent(tenantId, id);
    if (!existing) return null;
    const updated = await (this.prisma as any).alumniEvent.update({
      where: { id },
      data: toAlumniEvent({ ...existing, ...patch, id, tenantId }),
    });
    return mapAlumniEvent(updated);
  }
}

function mapAlumniProfile(row: any): AlumniProfileEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId ?? null,
    institutionId: row.institutionId ?? null,
    fullName: row.fullName,
    graduationYear: row.graduationYear,
    lastClassName: row.lastClassName ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toAlumniProfile(row: AlumniProfileEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId ?? null,
    institutionId: row.institutionId ?? null,
    fullName: row.fullName,
    graduationYear: row.graduationYear,
    lastClassName: row.lastClassName ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    status: row.status,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
function mapAlumniEvent(row: any): AlumniEventEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    institutionId: row.institutionId ?? null,
    title: row.title,
    eventDate: row.eventDate,
    location: row.location ?? null,
    status: row.status,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function toAlumniEvent(row: AlumniEventEntity) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    institutionId: row.institutionId ?? null,
    title: row.title,
    eventDate: row.eventDate,
    location: row.location ?? null,
    status: row.status,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
