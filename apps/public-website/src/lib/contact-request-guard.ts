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
