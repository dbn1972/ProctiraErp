/**
 * Theme review API client.
 */
import { gatewayFetch } from './gateway';

export type ThemeStatus = 'submitted' | 'in_review' | 'approved' | 'rejected';

export interface ThemeSubmission {
  id: string;
  name: string;
  vendor: string;
  version: string;
  status: ThemeStatus;
  submittedAt: string;
  /** Preview screenshot URL. */
  previewUrl: string;
  /** Brand summary for review. */
  description: string;
  /** Tokens overridden by the theme (count). */
  tokenOverrides: number;
}

const STUB_THEMES: ThemeSubmission[] = [
  {
    id: 'thm_001',
    name: 'Sunrise Bright',
    vendor: 'Education Brands',
    version: '1.0.0',
    status: 'in_review',
    submittedAt: '2025-02-15T09:00:00Z',
    previewUrl: 'https://example.com/themes/sunrise/preview.png',
    description: 'Warm orange palette tuned for primary schools.',
    tokenOverrides: 14,
  },
  {
    id: 'thm_002',
    name: 'Coastal Calm',
    vendor: 'Oceanic Design',
    version: '2.3.1',
    status: 'submitted',
    submittedAt: '2025-02-22T13:30:00Z',
    previewUrl: 'https://example.com/themes/coastal/preview.png',
    description: 'Cool blue and sand tones, accessible AA contrast.',
    tokenOverrides: 22,
  },
  {
    id: 'thm_003',
    name: 'Government Steel',
    vendor: 'PublicSector UI',
    version: '4.0.0',
    status: 'approved',
    submittedAt: '2024-12-01T08:00:00Z',
    previewUrl: 'https://example.com/themes/steel/preview.png',
    description: 'High-contrast theme designed for ministerial deployments.',
    tokenOverrides: 18,
  },
];

export async function listThemes(): Promise<{
  themes: ThemeSubmission[];
  source: 'gateway' | 'stub';
}> {
  const response = await gatewayFetch<{
    items?: ThemeSubmission[];
    data?: ThemeSubmission[];
  }>('/themes');
  if (response.ok && response.data) {
    return {
      themes: response.data.items ?? response.data.data ?? [],
      source: 'gateway',
    };
  }
  return { themes: STUB_THEMES, source: 'stub' };
}

export async function getTheme(id: string): Promise<ThemeSubmission | null> {
  const response = await gatewayFetch<ThemeSubmission>(`/themes/${id}`);
  if (response.ok && response.data) return response.data;
  return STUB_THEMES.find((t) => t.id === id) ?? null;
}

export async function themeAction(
  id: string,
  action: 'approve' | 'reject',
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const response = await gatewayFetch<unknown>(`/themes/${id}/${action}`, {
    method: 'POST',
    json: { reason },
  });
  if (response.ok) return { ok: true };
  if (response.status === 0) return { ok: true };
  return { ok: false, error: response.error?.message ?? 'Action failed.' };
}
