/**
 * Admin tenant settings page — G-910.
 *
 * Reads `/tenant/settings` and saves through a Server Action (the form was
 * previously inert). Locale / timezone / academic-year start / branding /
 * contact are all persisted per tenant.
 *
 * Validates: Requirement 4.x — configure tenant identity, locales, branding.
 */
import { Card, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { getTenantSettings } from '@/lib/api/admin.server';
import { TenantSettingsForm } from '@/components/admin/admin-console-controls';
import { ScaffoldModeBanner } from '@/components/insights/ScaffoldModeBanner';

export const dynamic = 'force-dynamic';

export default async function TenantConfigPage() {
  const { settings, source } = await getTenantSettings();

  return (
    <section aria-labelledby="tenant-heading" className="space-y-6">
      <div>
        <h1 id="tenant-heading" className="text-3xl font-extrabold tracking-tight text-foreground">
          Tenant settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Display name, locales, timezone, academic-year start, branding, and contact details.
        </p>
      </div>

      {source === 'forbidden' ? (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          You need the tenant administrator role to change tenant settings.
        </p>
      ) : (
        <ScaffoldModeBanner
          source={source}
          surface="Admin tenant"
          detail="The settings form is hidden when the tenant admin API is offline."
        />
      )}

      {settings && source === 'gateway' ? (
        <TenantSettingsForm settings={settings} />
      ) : (
        <Card className="max-w-[860px]">
          <CardHeader>
            <CardTitle className="text-base">Tenant settings unavailable</CardTitle>
            <CardDescription>
              The tenant settings service is unreachable or you lack access. Check back shortly.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </section>
  );
}
