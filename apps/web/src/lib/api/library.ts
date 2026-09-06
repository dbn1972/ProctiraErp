import { gatewayFetch } from './gateway';

export interface LibraryTitle {
  id: string;
  tenantId: string;
  institutionId: string | null;
  title: string;
  author: string | null;
  isbn: string | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listLibraryTitles(): Promise<LibraryTitle[]> {
  try {
    const res = await gatewayFetch<{ data: LibraryTitle[] }>('/library/titles');
    if (Array.isArray(res.data)) return res.data;
    if (res.data && typeof res.data === 'object' && Array.isArray(res.data.data)) {
      return res.data.data;
    }
    return [];
  } catch {
    return [];
  }
}
