import type { Metadata } from 'next';

import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = {
  title: 'Plugin Marketplace — Developers',
  description: 'Browse and publish plugins (coming soon).',
};

export default function MarketplacePage() {
  return (
    <ComingSoon
      title="Plugin marketplace"
      description="Discover and publish platform plugins. The marketplace catalog is not online yet."
    />
  );
}
