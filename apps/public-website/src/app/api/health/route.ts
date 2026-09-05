/**
 * Health check endpoint for the public website Next.js app.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(): NextResponse {
  return NextResponse.json({
    status: 'ok',
    service: 'public-website',
    timestamp: new Date().toISOString(),
  });
}
