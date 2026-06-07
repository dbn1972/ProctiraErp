import { PageHeader } from '@/components/layout/page-header';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { requireRole } from '@/lib/auth/server';

import { NewTenantForm } from './new-tenant-form';

export default async function NewTenantPage() {
  await requireRole('tenants', '/tenants/new');

  return (
    <>
      <PageHeader
        title="Provision new tenant"
        description="Creates a new tenant in the platform with default core entitlements. The provisioning workflow runs asynchronously."
      />

      <Card>
        <CardHeader>
          <CardTitle>Tenant details</CardTitle>
          <CardDescription>
            Slug must be unique and is used in subdomains, queue prefixes, and
            audit identifiers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewTenantForm />
        </CardContent>
      </Card>
    </>
  );
}
