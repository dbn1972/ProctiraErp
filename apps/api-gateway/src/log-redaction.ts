/**
 * Access-log redaction for capability tokens carried in query strings (PRC-L344).
 */
const SENSITIVE_QUERY_KEYS = new Set(['token', 'access_token', 'ticket', 'signature']);

export function redactUrlQuerySecrets(url: string | undefined): string | undefined {
  if (!url) return url;
  const q = url.indexOf('?');
  if (q < 0) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  let changed = false;
  for (const key of [...params.keys()]) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      params.set(key, '[REDACTED]');
      changed = true;
    }
  }
  return changed ? `${url.slice(0, q)}?${params.toString()}` : url;
}

interface SerializableRequest {
  method?: string;
  url?: string;
  hostname?: string;
  ip?: string;
  socket?: { remotePort?: number };
}

/** Pino `req` serializer matching Fastify's default shape, with a redacted URL. */
export function redactedRequestSerializer(req: SerializableRequest) {
  return {
    method: req.method,
    url: redactUrlQuerySecrets(req.url),
    hostname: req.hostname,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}
