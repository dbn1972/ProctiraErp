import Link from 'next/link';

import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StubDataBanner } from '@/components/stub-data-banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { listTenants } from '@/lib/api/tenants';
import { listBreakGlassRequests } from '@/lib/api/break-glass';
import { requireRole } from '@/lib/auth/server';

import { TenantPicker } from './tenant-picker';

/**
 * /support — support tooling. Operators select a tenant from the list and see
 * the impact-scope summary (active users, plan, entitlements). Tenant
 * masquerade is disabled unless the operator holds an active break-glass
 * grant for the tenant.
 */
export default async function SupportPage({
  searchParams,
}: {
  searchParams: { tenantId?: string };
}) {
  const session = await requireRole('support', '/support');
  const { tenants, source: tenantsSource } = await listTenants();

  const selectedTenantId = searchParams?.tenantId;
  const selectedTenant = tenants.find((t) => t.id === selectedTenantId) ?? null;

  // An active break-glass grant for this tenant + the current operator is
  // required to enable masquerade. Stub: look up by requester email.
  const { requests, source: bgSource } = await listBreakGlassRequests();
  const hasActiveGrant = requests.some(
    (request) =>
      request.status === 'active' &&
      request.targetTenantId === selectedTenantId &&
      request.requester === session.user.email,
  );

  return (
    <>
      <PageHeader
        title="Support tooling"
        description="Inspect tenants, view impact-scope, and (with break-glass) masquerade for support."
      />

      <StubDataBanner
        source={tenantsSource === 'stub' || bgSource === 'stub' ? 'stub' : 'gateway'}
        detail="Tenant picker and break-glass grant checks use stub fixtures when the gateway is offline. Masquerade never opens a live elevated session in stub mode."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Select tenant</CardTitle>
            <CardDescription>
              Pick the tenant whose case you are working.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TenantPicker
              tenants={tenants.map((t) => ({
                id: t.id,
                name: t.name,
                slug: t.slug,
              }))}
              selectedId={selectedTenantId}
            />
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          {!selectedTenant ? (
            <Alert>
              <AlertTitle>No tenant selected</AlertTitle>
              <AlertDescription>
                Choose a tenant on the left to see its impact-scope summary.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Impact scope: {selectedTenant.name}</CardTitle>
                  <CardDescription>
                    Effects of any support actions you take.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ImpactRow label="Active users" value={selectedTenant.activeUsers.toLocaleString()} />
                  <ImpactRow label="Plan" value={selectedTenant.plan} />
                  <ImpactRow label="Region" value={selectedTenant.region} />
                  <ImpactRow label="Status" value={selectedTenant.status} />
                  <div className="pt-2">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      Entitlements
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedTenant.entitlements.map((e) => (
                        <Badge key={e} variant="info">
                          {e}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Masquerade as tenant administrator</CardTitle>
                  <CardDescription>
                    Open a session inside the tenant's app to reproduce a
                    customer issue. Requires an active break-glass grant.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {hasActiveGrant ? (
                    <Alert variant="success" className="mb-4">
                      <AlertDescription>
                        Active break-glass grant detected for your account.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Alert variant="warning" className="mb-4">
                      <AlertDescription>
                        Masquerade is gated on a security-approved break-glass
                        grant. Submit a request to proceed.
                      </AlertDescription>
                    </Alert>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={!hasActiveGrant}>
                      Open masquerade session
                    </Button>
                    <Button asChild variant="outline">
                      <Link
                        href={`/break-glass?tenantId=${encodeURIComponent(
                          selectedTenant.id,
                        )}`}
                      >
                        Request break-glass
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function ImpactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-2 last:border-b-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium capitalize">{value}</span>
    </div>
  );
}
