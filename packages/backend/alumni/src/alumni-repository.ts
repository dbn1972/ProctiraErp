/** Alumni repository ports (P25). */

export interface AlumniProfileEntity {
  id: string;
  tenantId: string;
  studentId: string | null;
  institutionId: string | null;
  fullName: string;
  graduationYear: number;
  lastClassName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlumniEventEntity {
  id: string;
  tenantId: string;
  institutionId: string | null;
  title: string;
  eventDate: string;
  location: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlumniRepository {
  listAlumniProfiles(tenantId: string): Promise<AlumniProfileEntity[]>;
  getAlumniProfile(tenantId: string, id: string): Promise<AlumniProfileEntity | null>;
  createAlumniProfile(row: AlumniProfileEntity): Promise<AlumniProfileEntity>;
  updateAlumniProfile(tenantId: string, id: string, patch: Partial<AlumniProfileEntity>): Promise<AlumniProfileEntity | null>;
  listAlumniEvents(tenantId: string): Promise<AlumniEventEntity[]>;
  getAlumniEvent(tenantId: string, id: string): Promise<AlumniEventEntity | null>;
  createAlumniEvent(row: AlumniEventEntity): Promise<AlumniEventEntity>;
  updateAlumniEvent(tenantId: string, id: string, patch: Partial<AlumniEventEntity>): Promise<AlumniEventEntity | null>;
}
