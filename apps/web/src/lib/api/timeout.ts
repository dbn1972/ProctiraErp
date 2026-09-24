/**
 * Request deadlines for the gateway clients.
 *
 * Neither `gatewayFetch` nor `browserGatewayFetch` had a timeout of any kind — no
 * `AbortController`, no `AbortSignal.timeout`, no race — and the gateway sets no
 * `requestTimeout` either. A handler that hung therefore held the connection with nothing
 * to abandon it from either end, and the user got an indefinite spinner: a failure with no
 * message, no code, and nothing to act on.
 *
 * Both clients now share this helper so a timeout looks the same wherever it happens.
 */

/** Distinct from `NETWORK_ERROR`: the server was reachable, it just did not answer. */
export const TIMEOUT_ERROR_CODE = 'TIMEOUT';
export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';

/**
 * V15-12 / V15-13 — statuses the clients used to flatten into one generic branch.
 *
 * Both clients ran every non-2xx through a single path, so a rate limit, an oversized
 * upload and a server fault were indistinguishable to a call site. The gateway sends
 * `Retry-After` on a 429 (`addHeaders` in `app.ts`) and nothing read it, so a user was told
 * "try again" with no idea when.
 */
export const RATE_LIMITED_ERROR_CODE = 'RATE_LIMIT_EXCEEDED';
export const PAYLOAD_TOO_LARGE_ERROR_CODE = 'PAYLOAD_TOO_LARGE';

export interface StatusFailure extends TransportFailure {
  /** Seconds to wait, parsed from `Retry-After`, when the server supplied one. */
  retryAfterSeconds?: number;
}

/**
 * Parse `Retry-After`, which RFC 9110 allows as either delta-seconds or an HTTP-date.
 *
 * Returns `undefined` rather than 0 for an unparseable or past value, so a caller can tell
 * "no guidance" from "retry immediately".
 */
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? seconds : undefined;
  }
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  const seconds = Math.ceil((at - now) / 1000);
  return seconds > 0 ? seconds : undefined;
}

/**
 * Give a non-2xx response a code and a message a screen can act on.
 *
 * The gateway's own `code` wins when it sent one — it is the contract. This only fills in
 * the cases where the body was absent or not the envelope (a proxy's HTML 502, a 413 that
 * never reached the app), and attaches the retry guidance the clients were discarding.
 */
export function classifyStatusFailure(
  response: { status: number; headers: { get(name: string): string | null } },
  envelope: { code: string; message: string } | null,
): StatusFailure {
  const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'));

  if (response.status === 429) {
    const message = retryAfterSeconds
      ? `Too many requests. Try again in ${retryAfterSeconds}s.`
      : 'Too many requests. Wait a moment and try again.';
    return {
      code: envelope?.code ?? RATE_LIMITED_ERROR_CODE,
      message,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    };
  }

  if (response.status === 413) {
    // Often produced by a proxy before the app is reached, so there is usually no envelope
    // and the generic "Gateway request failed" told the user nothing about the real cause.
    return {
      code: envelope?.code ?? PAYLOAD_TOO_LARGE_ERROR_CODE,
      message: envelope?.message ?? 'That file or request is too large to upload.',
    };
  }

  if (envelope) {
    return {
      code: envelope.code,
      message: envelope.message,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    };
  }

  return { code: 'GATEWAY_ERROR', message: 'The request could not be completed.' };
}

export interface TransportFailure {
  code: string;
  message: string;
}

export interface RequestTimeout {
  /** Pass to `fetch`. */
  signal: AbortSignal;
  /** Release the timer. Safe to call more than once. */
  clear: () => void;
  /**
   * Turn a rejected `fetch` into a transport failure.
   *
   * `fetch` reports an abort the same way whichever side triggered it, so the deadline
   * flag is the only way to tell "we gave up" from "the caller cancelled" — and a caller
   * cancelling (navigating away, a newer keystroke) is not an error to show anyone.
   */
  classify: (error: unknown) => TransportFailure;
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'AbortError')
  );
}

/**
 * Arm a deadline, honouring a caller-supplied signal alongside it.
 *
 * `AbortSignal.any` is not used: it is not available on every runtime this app builds for
 * (Node 20 gained it in 20.3, and the browser floor is older), so the caller's signal is
 * forwarded by listener instead.
 */
export function createTimeout(timeoutMs: number, callerSignal?: AbortSignal | null): RequestTimeout;
export function createTimeout(
  timeoutMs: number | undefined,
  callerSignal?: AbortSignal | null,
): RequestTimeout;
export function createTimeout(
  timeoutMs: number | undefined,
  callerSignal?: AbortSignal | null,
): RequestTimeout {
  const budget = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 0;
  const controller = new AbortController();
  let timedOut = false;

  const timer =
    budget > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, budget)
      : undefined;
  // Node keeps the process alive for a pending timer; a 30s deadline on a short-lived
  // script would otherwise delay exit by 30s.
  timer?.unref?.();

  const forwardAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', forwardAbort, { once: true });
  }

  const clear = () => {
    if (timer) clearTimeout(timer);
    callerSignal?.removeEventListener('abort', forwardAbort);
  };

  return {
    signal: controller.signal,
    clear,
    classify: (error: unknown): TransportFailure => {
      if (timedOut) {
        return {
          code: TIMEOUT_ERROR_CODE,
          message: `The server did not respond within ${Math.round(budget / 1000)}s.`,
        };
      }
      if (isAbort(error)) {
        // Caller-initiated. Reported with the network code rather than inventing a third
        // one, because no call site distinguishes it and a cancelled request is not shown.
        return { code: NETWORK_ERROR_CODE, message: 'Request was cancelled.' };
      }
      return {
        code: NETWORK_ERROR_CODE,
        message: error instanceof Error ? error.message : 'Network error',
      };
    },
  };
}
