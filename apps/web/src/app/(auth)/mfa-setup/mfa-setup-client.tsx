'use client';
import { MFASetupView } from '@/features/auth/MFASetup';

/**
 * App Router host for the MFA enrolment screen. Exits are explicit props
 * (hard navigations so middleware re-evaluates auth cookies); no React
 * Router bridge and no `window.history` patching (PRC-L022).
 */
export function MfaSetupClient(): JSX.Element {
  return (
    <MFASetupView
      onComplete={() => window.location.assign('/mfa')}
      renderSignInLink={(label) => <a href="/login">{label}</a>}
    />
  );
}
