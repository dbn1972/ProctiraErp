/**
 * Hostel overview (Server Component).
 */
import Link from 'next/link';
import {
  BedDouble,
  Building2,
  CalendarDays,
  ClipboardCheck,
  CircleDollarSign,
  DoorOpen,
  Utensils,
  Users,
} from 'lucide-react';

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
import { listHostels } from '@/lib/api/hostel';
import { NewHostelForm } from './_components/new-hostel-form';

export const dynamic = 'force-dynamic';

export default async function HostelOverviewPage() {
  await requireSession();
  const [t, hostels] = await Promise.all([getTranslations('hostel'), listHostels()]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <NewHostelForm />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('hostels')}</CardTitle>
          <CardDescription>{t('hostelCount', { count: hostels.length })}</CardDescription>
        </CardHeader>
        <CardContent>
          {hostels.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              {t('noHostels')}
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {hostels.map((hostel) => (
                <li key={hostel.id} className="py-3 first:pt-0 last:pb-0" data-testid="hostel-row">
                  <p className="text-sm font-medium text-foreground">
                    {hostel.name}{' '}
                    <span className="font-normal text-muted-foreground">({hostel.code})</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t('capacity', { count: hostel.capacity })} · {hostel.status}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" aria-hidden="true" />
              {t('structure')}
            </CardTitle>
            <CardDescription>{t('structureDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/hostel/structure">{t('manageStructure')}</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BedDouble className="h-4 w-4" aria-hidden="true" />
              {t('assignments')}
            </CardTitle>
            <CardDescription>{t('assignmentsDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/hostel/assignments">{t('openAssignments')}</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              {t('leaves')}
            </CardTitle>
            <CardDescription>{t('leavesDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/hostel/leaves">{t('openLeaves')}</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" aria-hidden="true" />
              {t('visitors')}
            </CardTitle>
            <CardDescription>{t('visitorsDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/hostel/visitors">{t('openVisitors')}</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Utensils className="h-4 w-4" aria-hidden="true" />
              Mess
            </CardTitle>
            <CardDescription>Plans, weekly menu, and subscriptions</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/hostel/mess">Open mess</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DoorOpen className="h-4 w-4" aria-hidden="true" />
              Gate passes
            </CardTitle>
            <CardDescription>Request, approve, and record out/in</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/hostel/gate-passes">Open gate passes</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleDollarSign className="h-4 w-4" aria-hidden="true" />
              Fee structures
            </CardTitle>
            <CardDescription>Room type × term amounts</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/hostel/fees">Open fees</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
              Night roll
            </CardTitle>
            <CardDescription>Present, absent, or on leave by block</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/hostel/attendance">Open attendance</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
