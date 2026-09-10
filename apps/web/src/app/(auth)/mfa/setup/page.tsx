import { permanentRedirect } from 'next/navigation';

/**
 * G-924 — `/mfa/setup` was a duplicate of `/mfa-setup`. Keep the URL alive for
 * deep links and probes, but serve one canonical enrolment screen.
 */
export default function MfaSetupNestedPage(): never {
  permanentRedirect('/mfa-setup');
}
