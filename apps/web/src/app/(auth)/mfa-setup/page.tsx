import { Suspense } from 'react';
import dynamic from 'next/dynamic';

const MfaSetupClient = dynamic(
  () => import('./mfa-setup-client').then((mod) => mod.MfaSetupClient),
  { ssr: false },
);

/**
 * MFA enrolment page (Server Component). Renders the federated
 * `<MFASetup>` feature (QR + backup codes) for E2E and Next.js deploys.
 */
export default function MfaSetupPage(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <MfaSetupClient />
    </Suspense>
  );
}
