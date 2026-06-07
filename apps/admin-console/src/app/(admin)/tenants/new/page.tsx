import Link from 'next/link';
import { Check, Info } from 'lucide-react';

import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { requireRole } from '@/lib/auth/server';

import { NewTenantForm } from './new-tenant-form';

const PROVISIONED_ITEMS = [
  'Isolated database schema with row-level security',
  'Dedicated object-storage bucket in the chosen region',
  'Auth realm with SSO + OTP login policies',
  'Message-queue vhost for async workflows',
  'Default theme and branding slot',
  'Administrator invite to the primary contact email',
];

export default async function NewTenantPage() {
  await requireRole('tenants', '/tenants/new');

  return (
    <>
      <PageHeader
        title="Provision a new tenant"
        description="Creates a new tenant in the platform with default core entitlements. The provisioning workflow runs asynchronously."
        actions={
          <Button asChild variant="ghost">
            <Link href="/tenants">Cancel</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Tenant details</CardTitle>
              <CardDescription>
                Slug must be unique and is used in subdomains, queue prefixes,
                and audit identifiers.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NewTenantForm />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What gets provisioned</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {PROVISIONED_ITEMS.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <Check
                      className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--success))]"
                      aria-hidden="true"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Alert variant="info">
            <Info className="h-4 w-4" />
            <AlertTitle>Provisioning is reversible for 72 hours</AlertTitle>
            <AlertDescription>
              A new tenant can be torn down without trace within 72 hours. After
              that, deletion requires a data-retention review.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </>
  );
}
