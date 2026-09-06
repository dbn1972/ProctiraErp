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
    if (Array.isArray(res.data)) return res.data;
    if (res.data && typeof res.data === 'object' && Array.isArray(res.data.data)) {
      return res.data.data;
    }
    return [];
  } catch {
    return [];
  }
}
