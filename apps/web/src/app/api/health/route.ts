/**
 * Health check endpoint for the Next.js web application.
 *
 * Returns a simple status payload used by container orchestrators
 * (Docker HEALTHCHECK, Kubernetes liveness/readiness probes).
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: 'ok',
    service: 'web',
    timestamp: new Date().toISOString(),
  });
}
