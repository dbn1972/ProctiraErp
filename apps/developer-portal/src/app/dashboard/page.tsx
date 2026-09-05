import type { Metadata } from 'next';

import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = {
  title: 'Developer Dashboard — ProctiraERP',
  description: 'API keys and sandbox tenants (coming soon).',
};

export default function DashboardPage() {
  return (
    <ComingSoon
      title="Developer dashboard"
      description="API key management and sandbox tenants will live here. Self-serve key issuance is not available yet."
    />
  );
}
