import { RouteAccessDenied } from '@/components/auth/route-access-denied';
import { hasDashboardDomainRouteAccess } from '@/lib/auth/domain-route-access';
import { NewRouteForm } from '../../_components/new-route-form';

export const dynamic = 'force-dynamic';

export default async function TransportNewRoutePage() {
  // T-D1: check before any transport or student-directory read.
  if (!(await hasDashboardDomainRouteAccess('transport', '/transport'))) {
    return <RouteAccessDenied />;
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New transport route</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Creates a new transport route for your school.
        </p>
      </div>
      <NewRouteForm />
    </div>
  );
}
