/** PRC-M108 — lesson/discussion lists render from one gateway call. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayFetch } = vi.hoisted(() => ({ gatewayFetch: vi.fn() }));
vi.mock('./gateway', () => ({ gatewayFetch, GatewayError: class extends Error {} }));

import { listDiscussions, listLessons } from './lms';

describe('LMS list embeds (PRC-M108)', () => {
  beforeEach(() => gatewayFetch.mockReset());

  it('lessons are listed with resources in a single request', async () => {
    gatewayFetch.mockResolvedValue({
      ok: true,
      data: { data: [{ id: 'l1', resources: [{ id: 'r1' }] }] },
    });
    const lessons = await listLessons();
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expect(gatewayFetch.mock.calls[0]![0]).toContain('include=resources');
    expect(lessons[0]!.resources).toHaveLength(1);
  });

  it('discussions are listed with posts in a single request', async () => {
    gatewayFetch.mockResolvedValue({ ok: true, data: { data: [{ id: 't1', posts: [] }] } });
    await listDiscussions();
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expect(gatewayFetch.mock.calls[0]![0]).toContain('include=posts');
  });
});
