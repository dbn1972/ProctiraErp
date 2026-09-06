'use client';

import { BrowserRouter } from 'react-router-dom';

import MFASetup from '@/features/auth/MFASetup';

/**
 * Client shell for the federated `<MFASetup>` screen inside the Next.js
 * app router. React Router hooks (`useNavigate`, `<Link>`) are required
 * by the feature module; `BrowserRouter` satisfies them without mounting
 * the full federated `RootRouter`.
 */
export function MfaSetupClient(): JSX.Element {
  return (
    <BrowserRouter>
      <MFASetup />
    </BrowserRouter>
  );
}
