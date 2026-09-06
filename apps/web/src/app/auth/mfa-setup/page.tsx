import { Suspense } from 'react';
import dynamic from 'next/dynamic';

const MfaSetupClient = dynamic(
  () =>
    import('../../(auth)/mfa-setup/mfa-setup-client').then(
      (mod) => mod.MfaSetupClient,
    ),
  { ssr: false },
);

/**
 * Alias route for `/auth/mfa-setup` (federated RootRouter path) so E2E
 * and deep links resolve without the SPA shell.
 */
export default function AuthMfaSetupPage(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <MfaSetupClient />
    </Suspense>
  );
}
