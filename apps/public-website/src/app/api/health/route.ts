/**
 * Health check endpoint for the public website Next.js app.
 *
 * Reports non-secret sink configuration (never the webhook URL itself). In
 * production a missing/invalid CONTACT_WEBHOOK_URL reports `status: degraded`
 * because contact submissions would only be logged, not delivered. The HTTP
 * status stays 200 so a config gap does not make liveness probes restart pods;
 * readiness/alerting should key on the `status` field.
 */
import { NextResponse } from 'next/server';
import { buildHealthReport } from '@/lib/health';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(): NextResponse {
  return NextResponse.json(buildHealthReport(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
