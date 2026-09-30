import { Suspense } from 'react';

import { AuthShell } from '../_components/auth-shell';
import { MfaForm } from './mfa-form';

/**
 * MFA verification page (Server Component). The challenge token is held in an
 * httpOnly cookie set by the login route when it signals `requiresMfa`
 * (PRC-L024) — it is never carried in the URL. Uses the shared
 * split-screen {@link AuthShell}.
 */
export default function MfaPage(): JSX.Element {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <MfaForm />
      </Suspense>
    </AuthShell>
  );
}
