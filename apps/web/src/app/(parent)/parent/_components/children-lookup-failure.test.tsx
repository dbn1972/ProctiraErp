/**
 * PRC-L062 — a failed linked-children lookup renders a load error, not
 * "No linked children".
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({ user: { sub: 'p1' } })),
}));
// PRC-L064 (#524): the library page formats due dates with the request locale.
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'en-IN') }));
vi.mock('@/lib/load-entity-labels', () => ({
  loadStudentLabelsForIds: vi.fn(async () => new Map()),
}));
const fetchList = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/list-result', () => ({ fetchList: (...a: unknown[]) => fetchList(...a) }));

import ParentAttendancePage from '../attendance/page';
import ParentLibraryPage from '../library/page';

/** Resolve the page and its (async) AcademicFrame into a renderable tree. */
async function resolvePage(page: Promise<ReactElement>): Promise<ReactElement> {
  const el = await page;
  const type = el.type as (props: unknown) => Promise<ReactElement> | ReactElement;
  return typeof type === 'function' ? await type(el.props) : el;
}

beforeEach(() => {
  fetchList.mockReset();
  fetchList.mockResolvedValue({ ok: false, kind: 'unavailable', status: 503 });
});

describe('parent pages with a failed children lookup (PRC-L062)', () => {
  it.each([
    ['attendance', ParentAttendancePage],
    ['library', ParentLibraryPage],
  ])('%s shows "could not be loaded" on gateway 503', async (_name, Page) => {
    render(await resolvePage(Page({ searchParams: Promise.resolve({}) })));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Linked children could not be loaded. Try again later.',
    );
    expect(screen.queryByText(/No linked children/)).toBeNull();
    expect(fetchList).toHaveBeenCalledWith('/parent-portal/children', expect.anything());
  });

  it('no (parent) page uses the swallowing listChildren() helper', () => {
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !name.includes('.test.')) {
          if (/\blistChildren\(/.test(readFileSync(p, 'utf8'))) offenders.push(p);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
