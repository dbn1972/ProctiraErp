import { Suspense } from 'react';

import { AuthShell } from '../_components/auth-shell';
import { SignUpForm } from './signup-form';

/**
 * Sign-up page (Server Component, Task 49.2).
 *
 * Uses the shared split-screen {@link AuthShell} so the first-run experience
 * stays cohesive with `/login`. The form, role picker, password strength
 * meter, and federated buttons live in the client `SignUpForm`.
 */
export default function SignUpPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <SignUpForm />
      </Suspense>
    </AuthShell>
  );
}
