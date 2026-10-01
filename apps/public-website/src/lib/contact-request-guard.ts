/**
 * Request guards for `POST /api/contact`: same-origin + JSON content type.
 * Pure (Headers in, verdict out) so they are unit-testable without Next.js.
 */
export type GuardVerdict = { ok: true } | { ok: false; status: 403 | 415; error: string };

function requestHost(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  return (forwarded || headers.get('host')?.trim() || null)?.toLowerCase() ?? null;
}

/**
 * Reject cross-site browser POSTs. `Sec-Fetch-Site` is authoritative when
 * present; otherwise an `Origin` header must match the request host.
 * Non-browser clients sending neither header are allowed (rate limit applies).
 */
export function checkSameOrigin(headers: Headers): GuardVerdict {
  const site = headers.get('sec-fetch-site')?.toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') {
    return { ok: false, status: 403, error: 'Cross-origin requests are not allowed.' };
  }
  const origin = headers.get('origin');
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      originHost = null;
    }
    const host = requestHost(headers);
    if (!originHost || !host || originHost !== host) {
      return { ok: false, status: 403, error: 'Cross-origin requests are not allowed.' };
    }
  }
  return { ok: true };
}

export function checkJsonContentType(headers: Headers): GuardVerdict {
  const type = headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') {
    return { ok: false, status: 415, error: 'Content-Type must be application/json.' };
  }
  return { ok: true };
}

/** Max accepted contact body (fields total ~4.6KB max; leave headroom for JSON). */
export const CONTACT_MAX_BODY_BYTES = 16 * 1024;

export class BodyTooLargeError extends Error {
  constructor() {
    super('Request body too large.');
    this.name = 'BodyTooLargeError';
  }
}

/**
 * Read the request body as text, rejecting early via Content-Length and
 * enforcing the cap while streaming (chunked bodies have no Content-Length).
 */
export async function readBodyWithLimit(
  request: Request,
  maxBytes: number = CONTACT_MAX_BODY_BYTES,
): Promise<string> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** Only https webhook targets are used (http allowed outside production for local CRMs). */
export function resolveWebhookUrl(
  env: Record<string, string | undefined> = process.env,
): URL | null {
  const raw = env.CONTACT_WEBHOOK_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:') return url;
    if (url.protocol === 'http:' && env.NODE_ENV !== 'production') return url;
  } catch {
    // invalid URL
  }
  return null;
}
