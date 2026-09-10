/**
 * Role dashboards — board / principal / teacher / parent (G-909).
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { Button, Card, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { ScaffoldModeBanner } from '@/components/insights/ScaffoldModeBanner';
import { getSession } from '@/lib/auth/server';
import { getRoleDashboard, type DashboardRole } from '@/lib/api/reports';

import { RoleDashboardPanel } from '../_components/role-dashboard-panel';

export const dynamic = 'force-dynamic';

const ROLES: DashboardRole[] = ['board', 'principal', 'teacher', 'parent'];

function parseRole(value: string | string[] | undefined): DashboardRole | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && (ROLES as string[]).includes(raw)) return raw as DashboardRole;
  return undefined;
}

function isParentSession(
  roles: Array<{ roleId?: string; roleName?: string }> | undefined,
): boolean {
  return (roles ?? []).some((r) => {
    const n = `${r.roleId ?? ''} ${r.roleName ?? ''}`.toLowerCase();
    return n.includes('parent') || n.includes('guardian');
  });
}

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReportsDashboardPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const requested = parseRole(searchParams?.role);
  const session = await getSession();
  const parent = isParentSession(session?.user.roles);
  const role = parent ? 'parent' : requested;

  const { dashboard, source, status, error } = await getRoleDashboard(role);

  return (
    <section aria-labelledby="role-dashboard-heading" className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/reports">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Reports
        </Link>
      </Button>

      <div>
        <h1
          id="role-dashboard-heading"
          className="text-3xl font-extrabold tracking-tight text-foreground"
        >
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cards follow the signed-in role. Parents cannot load principal widgets.
        </p>
      </div>

      <ScaffoldModeBanner source={source} surface="Role dashboards" />

      {!parent && (
        <nav aria-label="Dashboard roles" className="flex flex-wrap gap-2">
          {ROLES.map((r) => (
            <Button
              key={r}
              asChild
              size="sm"
              variant={role === r || (!role && r === 'principal') ? 'default' : 'outline'}
            >
              <Link href={`/reports/dashboard?role=${r}`} data-testid={`dashboard-role-${r}`}>
                {r}
              </Link>
            </Button>
          ))}
        </nav>
      )}

      {status === 403 || !dashboard ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dashboard unavailable</CardTitle>
            <CardDescription>
              {error ??
                (status === 403
                  ? 'That role dashboard is not allowed for this session.'
                  : 'Connect the reports gateway to load live aggregates.')}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <RoleDashboardPanel dashboard={dashboard} />
      )}
    </section>
  );
}
