import { Suspense } from 'react';
import dynamic from 'next/dynamic';

const MfaSetupClient = dynamic(
  () => import('../../mfa-setup/mfa-setup-client').then((mod) => mod.MfaSetupClient),
  { ssr: false },
);

/** Alternate MFA enrolment path (`/mfa/setup`) probed by E2E specs. */
export default function MfaSetupNestedPage(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <MfaSetupClient />
    </Suspense>
  );
}
