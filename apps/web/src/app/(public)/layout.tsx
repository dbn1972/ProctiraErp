/**
 * Public layout for unauthenticated registration / tracking routes.
 * Uses the registration portal chrome (ProctiraERP brand) rather than
 * the marketing Features/Pricing header.
 */
import { RegistrationPortalShell } from '@/components/registration/portal-shell';

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RegistrationPortalShell compactFooter>{children}</RegistrationPortalShell>;
}
