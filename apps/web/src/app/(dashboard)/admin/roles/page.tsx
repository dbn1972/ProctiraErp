/**
 * Admin roles list (Server Component).
 *
 * Validates: Requirement 4.x — manage roles and assign permissions.
 */
import { Plus } from 'lucide-react';

import {
  Badge,
  Button,
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
import { listRoles } from '@/lib/api/admin.server';

export const dynamic = 'force-dynamic';

export default async function AdminRolesPage() {
  const roles = await listRoles();

  return (
    <section aria-labelledby="roles-heading" className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 id="roles-heading" className="text-2xl font-semibold tracking-tight">
            Roles
          </h1>
          <p className="text-sm text-muted-foreground">
            Define roles by bundling permissions, then assign roles to users.
          </p>
        </div>
        <Button>
          <Plus className="me-2 h-4 w-4" aria-hidden="true" />
          New role
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All roles</CardTitle>
          <CardDescription>
            {roles.length.toLocaleString()} roles defined.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {roles.length === 0 ? (
            <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              No roles defined.
            </p>
          ) : (
            <Table aria-label="Roles">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Permissions</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell className="font-medium">{role.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {role.description ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">{role.permissionCount}</TableCell>
                    <TableCell>
                      {role.isSystem ? (
                        <Badge variant="secondary">System</Badge>
                      ) : (
                        <Badge variant="outline">Custom</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      <Button variant="ghost" size="sm" disabled={role.isSystem}>
                        Edit
                      </Button>
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
