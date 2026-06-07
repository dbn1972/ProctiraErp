import { Suspense } from 'react';

import { AuthShell } from '../_components/auth-shell';
import { ResetPasswordForm } from './reset-password-form';

/**
 * Reset password page entry point (Server Component). The reset token comes in
 * via the `token` query string from the email link sent by /forgot-password.
 * Uses the shared split-screen {@link AuthShell}.
 */
export default function ResetPasswordPage(): JSX.Element {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
