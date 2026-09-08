import { NextResponse } from 'next/server';

import { BOOTSTRAP_STEPS, markStepComplete, type BootstrapStep } from '@/lib/bootstrap-lock';
import { assertInstallSecurity } from '@/lib/install-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isBootstrapStep(value: string): value is BootstrapStep {
  return (BOOTSTRAP_STEPS as readonly string[]).includes(value);
}

/**
 * Local configure step — records progress and enforces bootstrap lock + CSRF/token.
 * Upstream connectivity is not required for the wizard BFF lock proof.
 */
export async function POST(
  request: Request,
  context: { params: { step: string } },
): Promise<NextResponse> {
  const security = assertInstallSecurity(request);
  if (!security.ok) {
    return NextResponse.json(
      { success: false, error: security.error },
      { status: security.status },
    );
  }

  const stepParam = context.params.step;
  if (!isBootstrapStep(stepParam)) {
    return NextResponse.json(
      {
        success: false,
        step: stepParam,
        message: 'Unknown step',
        error: 'Unknown configure step.',
      },
      { status: 404 },
    );
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // Light structural checks — real adapter validation still lives in the backend package.
  if (stepParam === 'database') {
    const db = body as { host?: string; username?: string; password?: string; database?: string };
    if (!db.host || !db.username || !db.password || !db.database) {
      return NextResponse.json(
        {
          success: false,
          step: 'database',
          message: 'Database fields required',
          error: 'host, database, username, and password are required.',
        },
        { status: 400 },
      );
    }
  }

  const result = markStepComplete(security.session, stepParam);
  if (!result.ok) {
    return NextResponse.json(
      {
        success: false,
        step: stepParam,
        message: result.status === 409 ? 'Bootstrap locked' : 'Configure rejected',
        error: result.error,
      },
      { status: result.status },
    );
  }

  return NextResponse.json({
    success: true,
    step: stepParam,
    message: `${stepParam} configured (local bootstrap session)`,
  });
}
