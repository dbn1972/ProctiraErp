/**
 * Pure health report builder for `GET /api/health` (kept out of the route
 * module because Next.js route files may only export route handlers/config).
 */
import { resolveWebhookUrl } from '@/lib/contact-request-guard';
import { hasConfiguredProbes, readStatusProbeUrlsFromEnv } from '@/lib/status-probes';

export interface HealthReport {
  status: 'ok' | 'degraded';
  service: 'public-website';
  timestamp: string;
  checks: {
    contactSink: 'configured' | 'missing' | 'invalid';
    statusProbes: 'configured' | 'unconfigured';
  };
}

export function buildHealthReport(
  env: Record<string, string | undefined> = process.env,
  now: () => Date = () => new Date(),
): HealthReport {
  const rawWebhook = env.CONTACT_WEBHOOK_URL?.trim();
  const contactSink = !rawWebhook ? 'missing' : resolveWebhookUrl(env) ? 'configured' : 'invalid';
  const statusProbes = hasConfiguredProbes(readStatusProbeUrlsFromEnv(env))
    ? 'configured'
    : 'unconfigured';
  const degraded = env.NODE_ENV === 'production' && contactSink !== 'configured';
  return {
    status: degraded ? 'degraded' : 'ok',
    service: 'public-website',
    timestamp: now().toISOString(),
    checks: { contactSink, statusProbes },
  };
}
