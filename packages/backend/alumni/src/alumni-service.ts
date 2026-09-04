import { randomUUID } from 'node:crypto';
import type {
  AlumniProfileEntity,
  AlumniEventEntity,
  AlumniRepository,
} from './alumni-repository.js';

export class AlumniService {
  constructor(private readonly repo: AlumniRepository) {}

  listAlumniProfiles(tenantId: string) {
    return this.repo.listAlumniProfiles(tenantId);
  }
  getAlumniProfile(tenantId: string, id: string) {
    return this.repo.getAlumniProfile(tenantId, id);
  }
  createAlumniProfile(
    tenantId: string,
    input: Omit<AlumniProfileEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createAlumniProfile({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as AlumniProfileEntity);
  }
  updateAlumniProfile(tenantId: string, id: string, patch: Partial<AlumniProfileEntity>) {
    return this.repo.updateAlumniProfile(tenantId, id, patch);
  }
  listAlumniEvents(tenantId: string) {
    return this.repo.listAlumniEvents(tenantId);
  }
  getAlumniEvent(tenantId: string, id: string) {
    return this.repo.getAlumniEvent(tenantId, id);
  }
  createAlumniEvent(
    tenantId: string,
    input: Omit<AlumniEventEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ) {
    const now = new Date().toISOString();
    return this.repo.createAlumniEvent({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    } as AlumniEventEntity);
  }
  updateAlumniEvent(tenantId: string, id: string, patch: Partial<AlumniEventEntity>) {
    return this.repo.updateAlumniEvent(tenantId, id, patch);
  }
}
