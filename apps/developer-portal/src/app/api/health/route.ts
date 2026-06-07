/**
 * Health check endpoint for the developer portal Next.js app.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: 'ok',
    service: 'developer-portal',
    timestamp: new Date().toISOString(),
  });
}
