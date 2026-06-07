/**
 * RegistrationForm — multi-step admission application form.
 *
 * Renders the canonical `<RegistrationWizard>` (Task 51.1). The
 * full School Finder + ranked-preference + upload widgets land in
 * tasks 51.2–51.5; the wizard's state machine and Zod-gated step
 * advancement work today.
 */
import { RegistrationWizard } from '../RegistrationWizard';

export default function RegistrationForm() {
  return <RegistrationWizard />;
}
