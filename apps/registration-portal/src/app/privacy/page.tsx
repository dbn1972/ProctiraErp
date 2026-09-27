import type { Metadata } from 'next';

import { LegalPage } from '@/components/layout/legal-page';

export const metadata: Metadata = {
  title: 'Privacy notice',
  description: 'How this school registration portal uses application details you submit.',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      titleKey="privacyTitle"
      leadKey="privacyLead"
      sections={[
        { titleKey: 'privacyCollectTitle', bodyKey: 'privacyCollect' },
        { titleKey: 'privacyUseTitle', bodyKey: 'privacyUse' },
        { titleKey: 'contactTitle', bodyKey: 'privacyContact' },
      ]}
    />
  );
}
