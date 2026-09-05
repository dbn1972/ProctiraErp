import type { Metadata } from 'next';

import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = {
  title: 'Documentation — ProctiraERP Developers',
  description: 'Developer documentation and API reference (coming soon).',
};

export default function DocsPage() {
  return (
    <ComingSoon
      title="Documentation"
      description="API reference, quickstarts, and plugin guides are being published here. Use the home page samples until the full docs site ships."
    />
  );
}
