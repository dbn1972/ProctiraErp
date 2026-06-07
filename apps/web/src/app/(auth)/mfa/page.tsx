import { Suspense } from 'react';

import { AuthShell } from '../_components/auth-shell';
import { MfaForm } from './mfa-form';

/**
 * MFA verification page (Server Component). The mfaToken arrives as a query
 * string after the login route signals `requiresMfa`. Uses the shared
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
