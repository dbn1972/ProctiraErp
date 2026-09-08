/**
 * Transport overview (Server Component).
 */
import Link from 'next/link';
import { Bus, MapPinned, Users } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { getTranslations } from 'next-intl/server';

import { requireSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

export default async function TransportOverviewPage() {
  await requireSession();
  const t = await getTranslations('transport');

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPinned className="h-4 w-4" aria-hidden="true" />
              {t('routes')}
            </CardTitle>
            <CardDescription>{t('routesDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/transport/routes">{t('openRoutes')}</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bus className="h-4 w-4" aria-hidden="true" />
              {t('vehicles')}
            </CardTitle>
            <CardDescription>{t('vehiclesDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/transport/vehicles">{t('openVehicles')}</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" aria-hidden="true" />
              {t('assignments')}
            </CardTitle>
            <CardDescription>{t('assignmentsDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/transport/assignments">{t('openAssignments')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
