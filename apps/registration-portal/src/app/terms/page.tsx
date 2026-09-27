import type { Metadata } from 'next';

import { LegalPage } from '@/components/layout/legal-page';

export const metadata: Metadata = {
  title: 'Terms of use',
  description: 'Terms for families applying to a school through this registration portal.',
};

export default function TermsPage() {
  return (
    <LegalPage
      titleKey="termsTitle"
      leadKey="termsLead"
      sections={[
        { titleKey: 'termsUseTitle', bodyKey: 'termsUse' },
        { titleKey: 'termsSchoolTitle', bodyKey: 'termsSchool' },
      ]}
    />
  );
}
