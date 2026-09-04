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
    return Array.isArray(res) ? res : (res.data ?? []);
  } catch {
    return [];
  }
}
