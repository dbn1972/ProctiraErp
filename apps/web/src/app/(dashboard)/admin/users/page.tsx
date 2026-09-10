/**
 * Admin users list (Server Component) — G-910.
 *
 * Reads `/tenant/users` + `/tenant/roles`; invite / role edit / suspend are
 * live Server Actions (previously inert buttons).
 *
 * Validates: Requirement 4.x — manage users in the active tenant.
 */
import {
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import { listTenantRoles, listTenantUsers, type TenantUser } from '@/lib/api/admin.server';
import { cn } from '@/lib/utils';
import { InviteUserDialog, UserRowActions } from '@/components/admin/admin-console-controls';
import { ScaffoldModeBanner } from '@/components/insights/ScaffoldModeBanner';

export const dynamic = 'force-dynamic';

const AVATAR_PALETTE = [
  'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900 dark:text-fuchsia-300',
];

function avatarClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length] ?? AVATAR_PALETTE[0]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!;
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1]!;
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

export default async function AdminUsersPage() {
  const [{ users, source }, { roles }] = await Promise.all([listTenantUsers(), listTenantRoles()]);
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const activeCount = users.filter((u) => u.status === 'ACTIVE').length;

  return (
    <section aria-labelledby="users-heading" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 id="users-heading" className="text-3xl font-extrabold tracking-tight text-foreground">
            Users
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {users.length.toLocaleString()} accounts ({activeCount.toLocaleString()} active) ·
            invites, roles, and security status.
          </p>
        </div>
        {source === 'gateway' ? <InviteUserDialog roles={roles} /> : null}
      </div>

      {source === 'forbidden' ? (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          You need the tenant administrator role to manage users.
        </p>
      ) : (
        <ScaffoldModeBanner
          source={source}
          surface="Admin users"
          detail="Lists stay empty when the tenant admin API is offline."
        />
      )}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {users.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No users yet. Invite your first teammate.
            </p>
          ) : (
            <Table aria-label="Users">
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="font-semibold">User</TableHead>
                  <TableHead className="font-semibold">Roles</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="text-end font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id} className="group" data-testid={`user-row-${user.email}`}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                            avatarClass(user.displayName || user.email),
                          )}
                          aria-hidden="true"
                        >
                          {initials(user.displayName || user.email)}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">
                            {user.displayName}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.roleIds.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {user.roleIds.map((roleId) => (
                            <span
                              key={roleId}
                              className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:bg-sky-900 dark:text-sky-300"
                            >
                              {roleName.get(roleId) ?? roleId}
                            </span>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <UserStatus status={user.status} />
                    </TableCell>
                    <TableCell className="text-end">
                      <UserRowActions user={user} roles={roles} />
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

function UserStatus({ status }: { status: TenantUser['status'] }) {
  const map: Record<TenantUser['status'], { label: string; className: string }> = {
    ACTIVE: {
      label: 'Active',
      className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
    },
    SUSPENDED: {
      label: 'Suspended',
      className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    },
    INVITED: {
      label: 'Invited',
      className: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    },
  };
  const { label, className } = map[status] ?? map.INVITED;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
        className,
      )}
      data-testid="user-status"
    >
      {label}
    </span>
  );
}
