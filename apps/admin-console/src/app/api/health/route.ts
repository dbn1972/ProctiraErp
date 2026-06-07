/**
 * Health check endpoint for the admin console Next.js app.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: 'ok',
    service: 'admin-console',
    timestamp: new Date().toISOString(),
  });
}
