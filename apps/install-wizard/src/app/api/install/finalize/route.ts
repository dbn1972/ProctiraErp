import { NextResponse } from 'next/server';

import { finalizeSession } from '@/lib/bootstrap-lock';
import { assertInstallSecurity } from '@/lib/install-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Finalize local bootstrap session and engage one-time lock.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const security = assertInstallSecurity(request);
  if (!security.ok) {
    return NextResponse.json(
      { success: false, error: security.error },
      { status: security.status },
    );
  }

  const result = finalizeSession(security.session);
  if (!result.ok) {
    return NextResponse.json(
      {
        success: false,
        runId: '',
        completedAt: '',
        adapters: {},
        error: result.error,
      },
      { status: result.status },
    );
  }

  return NextResponse.json({
    success: true,
    runId: result.runId,
    completedAt: result.completedAt,
    adapters: {
      cdn: 'configured',
      database: 'configured',
      storage: 'configured',
      cache: 'configured',
      queue: 'configured',
    },
  });
}
