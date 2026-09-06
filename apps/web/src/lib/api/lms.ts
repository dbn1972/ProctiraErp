import { gatewayFetch } from './gateway';

export interface LmsCourse {
  id: string;
  tenantId: string;
  institutionId: string;
  classId: string | null;
  subjectId: string | null;
  staffId: string | null;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export async function listLmsCourses(): Promise<LmsCourse[]> {
  try {
    const res = await gatewayFetch<{ data: LmsCourse[] }>('/lms/courses');
    if (Array.isArray(res.data)) return res.data;
    if (res.data && typeof res.data === 'object' && Array.isArray(res.data.data)) {
      return res.data.data;
    }
    return [];
  } catch {
    return [];
  }
}
