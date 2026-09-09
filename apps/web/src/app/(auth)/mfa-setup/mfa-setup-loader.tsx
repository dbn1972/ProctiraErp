'use client';

import dynamic from 'next/dynamic';

/**
 * Client-side loader for the federated MFA enrolment screen. `ssr: false` is
 * only permitted inside a Client Component under Next 15, and the feature
 * needs `window` (QR rendering, React Router) so it must never render on the
 * server.
 */
export const MfaSetupLoader = dynamic(
  () => import('./mfa-setup-client').then((mod) => mod.MfaSetupClient),
  { ssr: false },
);
