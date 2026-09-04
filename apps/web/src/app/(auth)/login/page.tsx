import { Suspense } from 'react';

import { AuthShell } from '../_components/auth-shell';
import { LoginForm } from './login-form';

/**
 * Login page (Server Component). Uses the shared split-screen {@link AuthShell}
 * matching `redesign/web/auth-login.html`: ProctiraERP brand-first hero with
 * points, and the credential form on the right (password grant through the API gateway
 * (no identity-provider chrome)).
 */
export default function LoginPage(): JSX.Element {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
