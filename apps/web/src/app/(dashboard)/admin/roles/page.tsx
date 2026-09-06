/**
 * Admin roles list (Server Component).
 *
 * Validates: Requirement 4.x — manage roles and assign permissions.
 */
import Link from 'next/link';
import { LayoutGrid, Plus, ShieldCheck } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
} from '@proctira/ui/components';
import { listRoles } from '@/lib/api/admin.server';
import { cn } from '@/lib/utils';
import { ScaffoldModeBanner } from '@/components/insights/ScaffoldModeBanner';

export const dynamic = 'force-dynamic';

export default async function AdminRolesPage() {
  const roles = await listRoles();

  return (
    <section aria-labelledby="roles-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="roles-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Roles
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {roles.length.toLocaleString()} roles defined · bundle permissions, then
            assign them to users.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/permissions">
              <LayoutGrid className="me-1.5 h-4 w-4" aria-hidden="true" />
              Permission matrix
            </Link>
          </Button>
          <Button size="sm">
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            Create role
          </Button>
        </div>
      </div>

      <ScaffoldModeBanner
        surface="Admin roles"
        detail="Nested admin UI scaffold. Lists stay empty when tenant admin APIs are offline."
      />


      {roles.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No roles defined.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => (
            <Card key={role.id} className="h-full transition-colors hover:border-primary/40">
              <CardContent className="flex h-full flex-col gap-3 p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300">
                    <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-bold tracking-tight">
                      {role.name}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {role.isSystem ? 'System role · cannot be deleted' : 'Custom role'}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'ms-auto inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                      role.isSystem
                        ? 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300'
                        : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
                    )}
                  >
                    {role.isSystem ? 'System' : 'Custom'}
                  </span>
                </div>
                <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
                  {role.description ?? '—'}
                </p>
                <div className="flex items-center gap-2 border-t pt-3">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {role.permissionCount.toLocaleString()} permissions
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ms-auto"
                    disabled={role.isSystem}
                  >
                    Edit
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          <Card className="border-dashed">
            <CardContent className="flex h-full flex-col items-center justify-center gap-2.5 p-5 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300">
                <Plus className="h-5 w-5" aria-hidden="true" />
              </span>
              <h2 className="text-base font-bold tracking-tight">Create a custom role</h2>
              <p className="max-w-[30ch] text-sm text-muted-foreground">
                Start from a blank slate or duplicate an existing role and adjust its
                permissions.
              </p>
              <Button variant="outline" size="sm">
                New role
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  );
}
