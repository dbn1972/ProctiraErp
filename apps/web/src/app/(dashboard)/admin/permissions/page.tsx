/**
 * Admin permissions list (Server Component).
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
import { listPermissions } from '@/lib/api/admin.server';
import { type Permission } from '@/lib/api/admin';
import { cn } from '@/lib/utils';
import { ScaffoldModeBanner } from '@/components/insights/ScaffoldModeBanner';

export const dynamic = 'force-dynamic';

export default async function AdminPermissionsPage() {
  const { permissions, source } = await listPermissions();

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
            {permissions.length.toLocaleString()} granular permissions across modules. Assign
            permissions to roles to grant access.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/roles">
            <ShieldCheck className="me-1.5 h-4 w-4" aria-hidden="true" />
            Manage roles
          </Link>
        </Button>
      </div>

      <ScaffoldModeBanner
        source={source}
        surface="Admin permissions"
        detail="Nested admin UI scaffold. Lists stay empty when tenant admin APIs are offline."
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {permissions.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No permissions registered.
            </p>
          ) : (
            <Table aria-label="Permissions">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">Module</TableHead>
                  <TableHead className="font-semibold">Action</TableHead>
                  <TableHead className="font-semibold">Description</TableHead>
                  <TableHead className="text-right font-semibold">Roles</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {permissions.map((permission) => (
                  <TableRow key={permission.id} className="group">
                    <TableCell className="font-medium text-foreground">
                      {permission.module}
                    </TableCell>
                    <TableCell>
                      <ActionPill action={permission.action} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {permission.description}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {permission.rolesAssigned.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function ActionPill({ action }: { action: Permission['action'] }) {
  const map: Record<Permission['action'], string> = {
    create: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
    read: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
    update: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    delete: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    approve: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
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
