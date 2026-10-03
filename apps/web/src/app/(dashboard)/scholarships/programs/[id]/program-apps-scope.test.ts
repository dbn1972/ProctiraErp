/** PRC-M114 — the program detail applications request carries programId. */
import { describe, expect, it, vi } from 'vitest';

const listScholarshipApplications = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, items: [] })),
);
vi.mock('@/lib/api/scholarships', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/scholarships')>()),
  getScholarshipProgram: vi.fn(async () => null),
  listScholarshipApplications,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import Page from './page';

describe('program detail (PRC-M114)', () => {
  it('requests applications filtered by programId', async () => {
    await expect(Page({ params: Promise.resolve({ id: 'prog-1' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(listScholarshipApplications).toHaveBeenCalledWith({
      programId: 'prog-1',
      pageSize: 100,
    });
  });
});
