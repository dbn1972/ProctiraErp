import { Suspense } from 'react';

import { MfaSetupLoader } from './mfa-setup-loader';

/**
 * MFA enrolment page (Server Component). Renders the federated
 * `<MFASetup>` feature (QR + backup codes) for E2E and Next.js deploys.
 */
export default function MfaSetupPage(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <MfaSetupLoader />
    </Suspense>
  );
}
