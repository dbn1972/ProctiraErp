/**
 * Admin users list (Server Component).
 *
 * Validates: Requirement 4.x — manage users in the active tenant.
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
import { listUsers } from '@/lib/api/admin.server';
import { type AdminUser } from '@/lib/api/admin';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const users = await listUsers();

  return (
    <section aria-labelledby="users-heading" className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 id="users-heading" className="text-2xl font-semibold tracking-tight">
            Users
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage user accounts, statuses, and role assignments.
          </p>
        </div>
        <Button>
          <Plus className="me-2 h-4 w-4" aria-hidden="true" />
          Invite user
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All users</CardTitle>
          <CardDescription>
            {users.length.toLocaleString()} users in this tenant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              No users yet. Invite your first teammate.
            </p>
          ) : (
            <Table aria-label="Users">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead className="text-end">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.displayName}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell className="space-x-1">
                      {user.roles.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        user.roles.map((role) => (
                          <Badge key={role} variant="outline">
                            {role}
                          </Badge>
                        ))
                      )}
                    </TableCell>
                    <TableCell>
                      <UserStatus status={user.status} />
                    </TableCell>
                    <TableCell>{user.lastLoginAt ?? 'Never'}</TableCell>
                    <TableCell className="text-end">
                      <Button variant="ghost" size="sm">
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

function UserStatus({ status }: { status: AdminUser['status'] }) {
  switch (status) {
    case 'ACTIVE':
      return <Badge variant="success">Active</Badge>;
    case 'SUSPENDED':
      return <Badge variant="destructive">Suspended</Badge>;
    default:
      return <Badge variant="warning">Invited</Badge>;
  }
}
