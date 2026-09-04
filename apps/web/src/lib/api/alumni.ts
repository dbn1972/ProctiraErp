import { gatewayFetch } from './gateway';

export interface AlumniProfile {
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

export async function listAlumniProfiles(): Promise<AlumniProfile[]> {
  try {
    const res = await gatewayFetch<{ data: AlumniProfile[] }>('/alumni/profiles');
    return Array.isArray(res) ? res : (res.data ?? []);
  } catch {
    return [];
  }
}
