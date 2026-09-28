/**
 * Browser calls for scholarships go through the same-origin proxy so the
 * httpOnly session cookie is attached as a bearer token.
 */
import { CSRF_HEADER, readCsrfTokenFromDocument } from '@/lib/auth/csrf';
import { BrowserGatewayError } from '@/lib/api/browser-gateway';

export { BrowserGatewayError };

export async function scholarshipBrowserFetch<T>(
  path: string,
  init: {
    method?: string;
    json?: unknown;
    body?: BodyInit | null;
    headers?: HeadersInit;
  } = {},
): Promise<T> {
  const relative = path.startsWith('/scholarships')
    ? path.slice('/scholarships'.length)
    : path.startsWith('/')
      ? path
      : `/${path}`;
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  const csrfToken = readCsrfTokenFromDocument();
  if (csrfToken && !headers.has(CSRF_HEADER)) headers.set(CSRF_HEADER, csrfToken);

  let body: BodyInit | null | undefined = init.body;
  if (body == null && init.json !== undefined) {
    body = JSON.stringify(init.json);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`/api/scholarships${relative}`, {
    method: init.method ?? (body ? 'POST' : 'GET'),
    headers,
    body: body ?? null,
    credentials: 'same-origin',
  });

  const contentType = response.headers.get('content-type') ?? '';
  let payload: unknown = null;
  if (response.status !== 204 && contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : response.statusText || 'Scholarship request failed';
    const code =
      payload && typeof payload === 'object' && 'code' in payload
        ? String((payload as { code: unknown }).code)
        : 'GATEWAY_ERROR';
    throw new BrowserGatewayError({ status: response.status, code, message, details: payload });
  }

  return payload as T;
}
