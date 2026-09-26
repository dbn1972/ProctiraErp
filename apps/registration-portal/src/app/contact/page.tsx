import type { Metadata } from 'next';

import { LegalPage } from '@/components/layout/legal-page';

export const metadata: Metadata = {
  title: 'Contact the school',
  description: 'How to reach the school that runs this registration portal.',
};

export default function ContactPage() {
  return (
    <LegalPage
      titleKey="contactTitle"
      leadKey="contactLead"
      sections={[{ titleKey: 'contactTrackTitle', bodyKey: 'contactTrack' }]}
    />
  );
}
