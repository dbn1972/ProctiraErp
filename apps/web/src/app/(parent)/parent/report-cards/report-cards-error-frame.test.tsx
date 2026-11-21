/**
 * D1b (failing-first): when the report-cards read fails, the parent error frame must show a safe
 * generic message and the gateway correlation id, never the raw server or database error text.
 * The real `gatewayFetch` and `fetchAcademic` run; only the network and session edges are mocked.
 */
import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => ({ value: 'eyJ.access.token' }) }),
  headers: () => ({ get: () => null }),
}));
vi.mock('@/lib/auth', () => ({
  AUTH_COOKIES: {
    ACCESS_TOKEN: 'access_token',
    REFRESH_TOKEN: 'refresh_token',
    SESSION_ID: 'session_id',
  },
  decodeTokenPayload: () => ({
    sub: 'parent-1',
    tenantId: '11111111-1111-1111-1111-111111111111',
    email: 'parent@example.org',
    roles: [],
    iat: 1,
    exp: 9999999999,
  }),
}));
vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({ user: { sub: 'parent-1' } })),
}));
vi.mock('@/lib/load-entity-labels', () => ({
  loadStudentLabelsForIds: vi.fn(async () => new Map()),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/parent/report-cards',
  useSearchParams: () => new URLSearchParams(),
}));
const fetchList = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/list-result', () => ({ fetchList: (...a: unknown[]) => fetchList(...a) }));

const fetchMock = vi.fn<(...args: [string, RequestInit?]) => Promise<Response>>();
vi.stubGlobal('fetch', fetchMock);

import ParentReportCardsPage from './page';

const RAW = 'current transaction is aborted, commands ignored until end of transaction block';
const CORRELATION_ID = '2ee7694a-4534-4ad0-a4bf-44cc3f17b9d7';

/** Resolve the page and its (async) AcademicFrame into a renderable tree. */
async function resolvePage(page: Promise<ReactElement>): Promise<ReactElement> {
  const el = await page;
  const type = el.type as (props: unknown) => Promise<ReactElement> | ReactElement;
  return typeof type === 'function' ? await type(el.props) : el;
}

function gatewayError(status: number, body: object, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

async function renderPage(): Promise<string> {
  render(await resolvePage(ParentReportCardsPage({ searchParams: Promise.resolve({}) })));
  return document.body.textContent ?? '';
}

beforeEach(() => {
  document.body.innerHTML = '';
  fetchMock.mockReset();
  fetchList.mockReset();
  fetchList.mockResolvedValue({
    ok: true,
    items: [
      {
        id: 'link-1',
        tenantId: '11111111-1111-1111-1111-111111111111',
        parentUserId: 'parent-1',
        studentId: '22222222-2222-4222-8222-222222222222',
        relationship: 'guardian',
        status: 'active',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
  });
});

describe('parent report cards error frame (D1b)', () => {
  it('a 500 with raw database text shows a generic message and the reference id', async () => {
    fetchMock.mockResolvedValue(
      gatewayError(
        500,
        { code: '25P02', message: RAW, statusCode: 500 },
        { 'x-correlation-id': CORRELATION_ID },
      ),
    );
    const text = await renderPage();
    expect(text).not.toContain(RAW);
    expect(text).not.toContain('25P02');
    expect(text).toContain('Something went wrong loading this page.');
    expect(text).toContain('Unable to load this page. Try again later.');
    expect(text).toContain(`Reference: ${CORRELATION_ID}`);
  });

  it('a 503 without a correlation header shows the generic message and no reference', async () => {
    fetchMock.mockResolvedValue(
      gatewayError(503, {
        code: 'ACADEMIC_COLUMN_MISSING',
        message: 'column "x" does not exist',
        statusCode: 503,
      }),
    );
    const text = await renderPage();
    expect(text).not.toContain('column "x" does not exist');
    expect(text).toContain('Unable to load this page. Try again later.');
    expect(text).not.toContain('Reference:');
  });

  it('a malformed correlation header is not rendered', async () => {
    fetchMock.mockResolvedValue(
      gatewayError(
        500,
        { code: 'INTERNAL_ERROR', message: 'Internal server error', statusCode: 500 },
        { 'x-correlation-id': '<script>alert(1)</script>' },
      ),
    );
    const text = await renderPage();
    expect(text).not.toContain('<script>');
    expect(text).not.toContain('Reference:');
  });
});
