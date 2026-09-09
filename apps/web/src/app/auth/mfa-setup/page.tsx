import { permanentRedirect } from 'next/navigation';

/**
 * G-924 — `/auth/mfa-setup` (legacy federated RootRouter path) redirects to the
 * canonical `/mfa-setup` screen instead of rendering a second copy.
 */
export default function AuthMfaSetupPage(): never {
  permanentRedirect('/mfa-setup');
}
