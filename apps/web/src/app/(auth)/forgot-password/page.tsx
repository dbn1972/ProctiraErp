import { AuthShell } from '../_components/auth-shell';
import { ForgotPasswordForm } from './forgot-password-form';

/**
 * Forgot-password page (Server Component). Uses the shared split-screen
 * {@link AuthShell}; the email-entry / confirmation flow lives in the client
 * `ForgotPasswordForm`.
 */
export default function ForgotPasswordPage(): JSX.Element {
  return (
    <AuthShell>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
