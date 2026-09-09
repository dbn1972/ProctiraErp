/**
 * Admin permissions matrix (Server Component) — G-910.
 *
 * Reads the `/tenant/permissions` catalog and cross-references `/tenant/roles`
 * so the "Roles" column shows which roles actually grant each permission.
 *
 * Validates: Requirement 4.x — inspect granular permissions and role coverage.
 */
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import {
  listPermissionCatalog,
  listTenantRoles,
  type PermissionRef,
} from '@/lib/api/admin.server';
import { cn } from '@/lib/utils';
import { ScaffoldModeBanner } from '@/components/insights/ScaffoldModeBanner';

export const dynamic = 'force-dynamic';

const key = (p: PermissionRef) => `${p.resource}:${p.action}`;

export default async function AdminPermissionsPage() {
  const [{ permissions, source }, { roles }] = await Promise.all([
    listPermissionCatalog(),
    listTenantRoles(),
  ]);

  const grantedBy = new Map<string, string[]>();
  for (const role of roles) {
    for (const p of role.permissions) {
      const list = grantedBy.get(key(p)) ?? [];
      list.push(role.name);
      grantedBy.set(key(p), list);
    }
  }
  const sorted = [...permissions].sort(
    (a, b) => a.resource.localeCompare(b.resource) || a.action.localeCompare(b.action),
  );

  return (
    <section aria-labelledby="permissions-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            id="permissions-heading"
            className="text-3xl font-extrabold tracking-tight text-foreground"
          >
            Permissions
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {permissions.length.toLocaleString()} granular permissions across modules · which roles
            grant each one.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/roles">
            <ShieldCheck className="me-1.5 h-4 w-4" aria-hidden="true" />
            Manage roles
          </Link>
        </Button>
      </div>

      {source === 'forbidden' ? (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          You need the tenant administrator role to view the permission catalog.
        </p>
      ) : (
        <ScaffoldModeBanner
          source={source}
          surface="Admin permissions"
          detail="Lists stay empty when the tenant admin API is offline."
        />
      )}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {sorted.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No permissions registered.
            </p>
          ) : (
            <Table aria-label="Permissions">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Module</TableHead>
                  <TableHead className="font-semibold">Action</TableHead>
                  <TableHead className="font-semibold">Granted by</TableHead>
                  <TableHead className="text-end font-semibold">Roles</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((permission) => {
                  const names = grantedBy.get(key(permission)) ?? [];
                  return (
                    <TableRow key={key(permission)} className="group">
                      <TableCell className="font-medium text-foreground">
                        {permission.resource}
                      </TableCell>
                      <TableCell>
                        <ActionPill action={permission.action} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {names.length === 0 ? (
                          <span className="text-xs italic">Not granted by any role</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {names.map((name) => (
                              <span
                                key={name}
                                className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:bg-sky-900 dark:text-sky-300"
                              >
                                {name}
                              </span>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{names.length}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function ActionPill({ action }: { action: PermissionRef['action'] }) {
  const map: Record<PermissionRef['action'], string> = {
    create: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
    read: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
    list: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
    update: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    delete: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    manage: 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
        map[action],
      )}
    >
      {action}
    </span>
  );
}
