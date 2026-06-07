/**
 * Admin permissions list (Server Component).
 *
 * Validates: Requirement 4.x — inspect granular permissions and role coverage.
 */
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { listPermissions } from '@/lib/api/admin.server';
import { type Permission } from '@/lib/api/admin';

export const dynamic = 'force-dynamic';

export default async function AdminPermissionsPage() {
  const permissions = await listPermissions();

  return (
    <section aria-labelledby="permissions-heading" className="space-y-6">
      <header>
        <h1 id="permissions-heading" className="text-2xl font-semibold tracking-tight">
          Permissions
        </h1>
        <p className="text-sm text-muted-foreground">
          Granular permissions across modules. Assign permissions to roles to grant access.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All permissions</CardTitle>
          <CardDescription>
            {permissions.length.toLocaleString()} permissions defined.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {permissions.length === 0 ? (
            <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              No permissions registered.
            </p>
          ) : (
            <Table aria-label="Permissions">
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Roles</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {permissions.map((permission) => (
                  <TableRow key={permission.id}>
                    <TableCell>
                      <Badge variant="outline">{permission.module}</Badge>
                    </TableCell>
                    <TableCell>
                      <ActionBadge action={permission.action} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{permission.description}</TableCell>
                    <TableCell className="text-right">
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

function ActionBadge({ action }: { action: Permission['action'] }) {
  const variant: Record<Permission['action'], 'success' | 'warning' | 'secondary' | 'destructive'> = {
    create: 'success',
    read: 'secondary',
    update: 'warning',
    delete: 'destructive',
    approve: 'success',
  };
  return <Badge variant={variant[action]}>{action}</Badge>;
}
