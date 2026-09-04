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
    return Array.isArray(res) ? res : (res.data ?? []);
  } catch {
    return [];
  }
}
