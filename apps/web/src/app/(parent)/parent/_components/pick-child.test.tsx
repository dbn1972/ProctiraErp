/**
 * PRC-L063 — an unlinked ?studentId renders "forbidden" instead of silently
 * falling back to the first linked child.
 */
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({ user: { sub: 'p1' } })),
}));
vi.mock('@/lib/load-entity-labels', () => ({
  loadStudentLabelsForIds: vi.fn(async () => new Map()),
}));
const fetchList = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/list-result', () => ({ fetchList: (...a: unknown[]) => fetchList(...a) }));
const gatewayFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/gateway', async (orig) => ({
  ...(await orig<object>()),
  gatewayFetch: (...a: unknown[]) => gatewayFetch(...a),
}));

import ParentGradesPage from '../grades/page';
import ParentAttendancePage from '../attendance/page';
import { pickChild } from './academic-frame';

const LINKED = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000ff';
const link = { studentId: LINKED } as never;

async function resolvePage(page: Promise<ReactElement>): Promise<ReactElement> {
  const el = await page;
  const type = el.type as (props: unknown) => Promise<ReactElement> | ReactElement;
  return typeof type === 'function' ? await type(el.props) : el;
}

beforeEach(() => {
  fetchList.mockReset();
  gatewayFetch.mockReset();
  fetchList.mockResolvedValue({ ok: true, items: [link] });
});

describe('pickChild (PRC-L063)', () => {
  it('returns not-linked for an unmatched requested id', () => {
    expect(pickChild([link], OTHER)).toEqual({ child: null, reason: 'not-linked' });
    expect(pickChild([link], LINKED)).toEqual({ child: link, reason: 'ok' });
    expect(pickChild([link], undefined)).toEqual({ child: link, reason: 'ok' });
    expect(pickChild([], undefined)).toEqual({ child: null, reason: 'no-children' });
  });

  it.each([
    ['grades', ParentGradesPage],
    ['attendance', ParentAttendancePage],
  ])('%s?studentId=<not linked> shows forbidden and fetches no rows', async (_n, Page) => {
    render(await resolvePage(Page({ searchParams: Promise.resolve({ studentId: OTHER }) })));
    expect(screen.getByRole('status')).toHaveTextContent(
      'You can only view records for students linked to your account',
    );
    expect(gatewayFetch).not.toHaveBeenCalled();
  });
});
