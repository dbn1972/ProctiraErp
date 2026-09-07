import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { getBootstrapStatus, getInstallSession } from '@/lib/bootstrap-lock';
import { INSTALL_TOKEN_COOKIE, INSTALL_TOKEN_HEADER, readHeader } from '@/lib/install-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bootstrap status for the current install session (or empty unlocked status).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const cookieStore = cookies();
  const token =
    readHeader(request, INSTALL_TOKEN_HEADER) || cookieStore.get(INSTALL_TOKEN_COOKIE)?.value;
  const session = getInstallSession(token);
  if (!session) {
    return NextResponse.json({
      isComplete: false,
      completedSteps: [],
      pendingSteps: ['database', 'storage', 'cache', 'queue', 'cdn'],
      adapterStatuses: {},
    });
  }
  return NextResponse.json(getBootstrapStatus(session));
}
