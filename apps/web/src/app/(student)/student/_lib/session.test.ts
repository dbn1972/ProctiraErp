import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));
vi.mock('@/lib/auth/server', () => ({ requireSession: vi.fn() }));

import { studentStatus } from './session';

describe('studentStatus (PRC-L023)', () => {
  beforeEach(() => {
    redirect.mockClear();
  });

  it('redirects to /login?expired=true on a gateway 401', () => {
    expect(() => studentStatus({ ok: false, status: 401, payload: null })).toThrow(
      'NEXT_REDIRECT:/login?expired=true',
    );
    expect(redirect).toHaveBeenCalledWith('/login?expired=true');
  });

  it('keeps 403 as forbidden and reports 404 as not-found', () => {
    expect(studentStatus({ ok: false, status: 403, payload: null })).toBe('forbidden');
    expect(studentStatus({ ok: false, status: 404, payload: null })).toBe('not-found');
  });

  it('maps 5xx to error and success to ok', () => {
    expect(studentStatus({ ok: false, status: 503, payload: null })).toBe('error');
    expect(studentStatus({ ok: true, status: 200, payload: {} })).toBe('ok');
    expect(redirect).not.toHaveBeenCalled();
  });
});
