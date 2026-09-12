'use client';

import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@proctira/ui/components';

import { isAuthDemoModeEnabled } from '@/providers/AuthProvider';

/**
 * Honesty banner when `NEXT_PUBLIC_AUTH_DEMO_MODE=1`.
 *
 * Demo mode does **not** enable a stub credential path — sign-in still goes
 * through `/api/auth/login` + httpOnly cookies. The banner exists so local /
 * sandbox builds never look like a silent fake IdP.
 */
export function AuthDemoModeBanner(): JSX.Element | null {
  if (!isAuthDemoModeEnabled()) return null;

  return (
    <Alert
      variant="warning"
      className="mb-4"
      data-testid="auth-demo-mode-banner"
      role="status"
    >
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>Auth demo mode</AlertTitle>
      <AlertDescription>
        NEXT_PUBLIC_AUTH_DEMO_MODE is enabled. This is not a production IdP stub —
        credential and Keycloak sign-in still use the real cookie session gate.
      </AlertDescription>
    </Alert>
  );
}
