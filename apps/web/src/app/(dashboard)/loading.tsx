import { getTranslations } from 'next-intl/server';

import { RouteLoadingPanel } from '@/components/route-state/route-loading';

export default async function DashboardLoading() {
  const t = await getTranslations('common');
  return <RouteLoadingPanel label={t('loading')} />;
}
