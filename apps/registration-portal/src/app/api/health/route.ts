/**
 * Health check endpoint for the registration portal Next.js app.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: 'ok',
    service: 'registration-portal',
    timestamp: new Date().toISOString(),
  });
}
