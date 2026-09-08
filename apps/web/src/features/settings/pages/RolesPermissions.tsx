/**
 * RolesPermissions — Settings → Roles & Permissions (Task 59.3).
 *
 * Three sub-views per Design §R.3:
 *   1. Role list (CRUD on tenant-scoped roles; built-in roles read-only)
 *   2. Permission matrix (rows = permissions from the policy registry,
 *      columns = roles, cells = checkboxes)
 *   3. Role-to-user assignment grid (paginated user list, role multi-select
 *      per user)
 *
 * On every change the page calls a high-risk audit event endpoint (per
 * Requirement 33 AC 4 / Requirement 42 AC 5). The new permissions take
 * effect on the next request because the backend reads role permissions
 * per-request (no client-side caching on the policy registry).
 */
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  Label,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@proctira/ui/components';

import {
  type RolePermission,
  type TenantRole,
  type TenantUser,
  assignRolesToUser as assignRolesToUserApi,
  createRole as createRoleApi,
  deleteRole as deleteRoleApi,
  listPermissionCatalog,
  listTenantRoles,
  listTenantUsers,
  permissionKey,
  roleHasPermission,
  togglePermission,
  updateRolePermissions as updateRolePermissionsApi,
} from '@/lib/api/admin';

// ─── State machine ────────────────────────────────────────────────────────

interface State {
  loading: boolean;
  loadError: string | null;
  roles: TenantRole[];
  permissionCatalog: RolePermission[];
  selectedRoleId: string | null;
  /** Pending edits per role id — applied on save. */
  pendingPermissions: Record<string, RolePermission[]>;
  saving: boolean;
  saveError: string | null;
  saveSuccess: string | null;
  // Users tab
  usersLoading: boolean;
  users: TenantUser[];
  userSearch: string;
  // Recent inline audit events (Design §R.3 — last 5 changes shown inline).
  recentChanges: Array<{
    timestamp: string;
    summary: string;
  }>;
}

const initialState: State = {
  loading: true,
  loadError: null,
  roles: [],
  permissionCatalog: [],
  selectedRoleId: null,
  pendingPermissions: {},
  saving: false,
  saveError: null,
  saveSuccess: null,
  usersLoading: false,
  users: [],
  userSearch: '',
  recentChanges: [],
};

type Action =
  | { type: 'LOAD_START' }
  | {
      type: 'LOAD_OK';
      payload: { roles: TenantRole[]; permissions: RolePermission[] };
    }
  | { type: 'LOAD_FAIL'; message: string }
  | { type: 'SELECT_ROLE'; id: string }
  | {
      type: 'TOGGLE_PERMISSION';
      roleId: string;
      permission: RolePermission;
    }
  | { type: 'RESET_PENDING'; roleId: string }
  | { type: 'SAVE_START' }
  | { type: 'SAVE_OK'; role: TenantRole; summary: string }
  | { type: 'SAVE_FAIL'; message: string }
  | { type: 'CLEAR_FEEDBACK' }
  | { type: 'USERS_START' }
  | { type: 'USERS_OK'; users: TenantUser[] }
  | { type: 'USERS_SEARCH'; value: string }
  | { type: 'USER_UPDATED'; user: TenantUser; summary: string }
  | { type: 'ROLE_CREATED'; role: TenantRole; summary: string }
  | { type: 'ROLE_DELETED'; roleId: string; summary: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true, loadError: null };
    case 'LOAD_OK':
      return {
        ...state,
        loading: false,
        roles: action.payload.roles,
        permissionCatalog: action.payload.permissions,
        selectedRoleId: action.payload.roles[0]?.id ?? null,
      };
    case 'LOAD_FAIL':
      return { ...state, loading: false, loadError: action.message };
    case 'SELECT_ROLE':
      return { ...state, selectedRoleId: action.id, saveError: null, saveSuccess: null };
    case 'TOGGLE_PERMISSION': {
      const role = state.roles.find((r) => r.id === action.roleId);
      if (!role || role.builtIn) return state;
      const current = state.pendingPermissions[action.roleId] ?? role.permissions;
      const next = togglePermission(current, action.permission);
      return {
        ...state,
        pendingPermissions: { ...state.pendingPermissions, [action.roleId]: next },
        saveError: null,
        saveSuccess: null,
      };
    }
    case 'RESET_PENDING': {
      const next = { ...state.pendingPermissions };
      delete next[action.roleId];
      return { ...state, pendingPermissions: next, saveError: null, saveSuccess: null };
    }
    case 'SAVE_START':
      return { ...state, saving: true, saveError: null, saveSuccess: null };
    case 'SAVE_OK': {
      const nextPending = { ...state.pendingPermissions };
      delete nextPending[action.role.id];
      return {
        ...state,
        saving: false,
        roles: state.roles.map((r) => (r.id === action.role.id ? action.role : r)),
        pendingPermissions: nextPending,
        saveSuccess: action.summary,
        recentChanges: [
          { timestamp: new Date().toISOString(), summary: action.summary },
          ...state.recentChanges,
        ].slice(0, 5),
      };
    }
    case 'SAVE_FAIL':
      return { ...state, saving: false, saveError: action.message };
    case 'CLEAR_FEEDBACK':
      return { ...state, saveError: null, saveSuccess: null };
    case 'USERS_START':
      return { ...state, usersLoading: true };
    case 'USERS_OK':
      return { ...state, usersLoading: false, users: action.users };
    case 'USERS_SEARCH':
      return { ...state, userSearch: action.value };
    case 'USER_UPDATED':
      return {
        ...state,
        users: state.users.map((u) => (u.id === action.user.id ? action.user : u)),
        recentChanges: [
          { timestamp: new Date().toISOString(), summary: action.summary },
          ...state.recentChanges,
        ].slice(0, 5),
      };
    case 'ROLE_CREATED':
      return {
        ...state,
        roles: [...state.roles, action.role].sort((a, b) => a.name.localeCompare(b.name)),
        selectedRoleId: action.role.id,
        recentChanges: [
          { timestamp: new Date().toISOString(), summary: action.summary },
          ...state.recentChanges,
        ].slice(0, 5),
      };
    case 'ROLE_DELETED':
      return {
        ...state,
        roles: state.roles.filter((r) => r.id !== action.roleId),
        selectedRoleId: state.selectedRoleId === action.roleId ? null : state.selectedRoleId,
        recentChanges: [
          { timestamp: new Date().toISOString(), summary: action.summary },
          ...state.recentChanges,
        ].slice(0, 5),
      };
    default:
      return state;
  }
}

// ─── Component ────────────────────────────────────────────────────────────

export default function RolesPermissions(): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);

  const selectedRole = useMemo(
    () => state.roles.find((r) => r.id === state.selectedRoleId) ?? null,
    [state.roles, state.selectedRoleId],
  );

  const pendingForSelected = selectedRole
    ? (state.pendingPermissions[selectedRole.id] ?? selectedRole.permissions)
    : null;
  const hasUnsavedChanges =
    selectedRole != null && state.pendingPermissions[selectedRole.id] !== undefined;

  // ─── Initial load ───────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: 'LOAD_START' });
    Promise.all([listTenantRoles(), listPermissionCatalog()])
      .then(([roles, permissions]) => {
        if (cancelled) return;
        dispatch({ type: 'LOAD_OK', payload: { roles, permissions } });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        dispatch({
          type: 'LOAD_FAIL',
          message: err instanceof Error ? err.message : 'Failed to load roles',
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Users load ─────────────────────────────────────────────────────

  const reloadUsers = useCallback(async (search: string) => {
    dispatch({ type: 'USERS_START' });
    try {
      const result = await listTenantUsers({ search, pageSize: 50 });
      dispatch({ type: 'USERS_OK', users: result.data });
    } catch {
      dispatch({ type: 'USERS_OK', users: [] });
    }
  }, []);

  // ─── Save handler ───────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!selectedRole || !hasUnsavedChanges) return;
    const newPermissions = state.pendingPermissions[selectedRole.id]!;
    dispatch({ type: 'SAVE_START' });
    try {
      const updated = await updateRolePermissionsApi(
        selectedRole.id,
        { permissions: newPermissions },
        {
          roleName: selectedRole.name,
          previousPermissions: selectedRole.permissions,
        },
      );
      dispatch({
        type: 'SAVE_OK',
        role: updated,
        summary: `Updated permissions on role '${updated.name}'`,
      });
    } catch (err: unknown) {
      dispatch({
        type: 'SAVE_FAIL',
        message: err instanceof Error ? err.message : 'Failed to save changes',
      });
    }
  }, [selectedRole, hasUnsavedChanges, state.pendingPermissions]);

  // ─── Render ─────────────────────────────────────────────────────────

  if (state.loading) {
    return (
      <div className="space-y-6 p-6" role="status" aria-label="Loading roles and permissions">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (state.loadError) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>Could not load roles</AlertTitle>
          <AlertDescription>{state.loadError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Roles &amp; Permissions</h1>
        <p className="text-muted-foreground mt-1">
          Manage tenant-scoped roles, permissions, and user assignments. Every change is recorded as
          a high-risk audit event and applies on each user&apos;s next request.
        </p>
      </header>

      {state.saveError && (
        <Alert variant="destructive" data-testid="save-error">
          <AlertTitle>Save failed</AlertTitle>
          <AlertDescription>{state.saveError}</AlertDescription>
        </Alert>
      )}
      {state.saveSuccess && (
        <Alert data-testid="save-success">
          <AlertTitle>Saved</AlertTitle>
          <AlertDescription>{state.saveSuccess}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="roles" className="space-y-4">
        <TabsList>
          <TabsTrigger value="roles">Roles</TabsTrigger>
          <TabsTrigger value="matrix">Permission matrix</TabsTrigger>
          <TabsTrigger
            value="users"
            onClick={() => {
              if (state.users.length === 0 && !state.usersLoading) {
                void reloadUsers(state.userSearch);
              }
            }}
          >
            Role-to-user assignment
          </TabsTrigger>
        </TabsList>

        {/* ── Roles tab ─────────────────────────────────────────── */}
        <TabsContent value="roles">
          <RolesListView
            roles={state.roles}
            selectedRoleId={state.selectedRoleId}
            onSelect={(id) => dispatch({ type: 'SELECT_ROLE', id })}
            onCreate={async (name) => {
              try {
                const role = await createRoleApi({ name, permissions: [] });
                dispatch({
                  type: 'ROLE_CREATED',
                  role,
                  summary: `Created role '${role.name}'`,
                });
              } catch (err) {
                dispatch({
                  type: 'SAVE_FAIL',
                  message: err instanceof Error ? err.message : 'Failed to create role',
                });
              }
            }}
            onDelete={async (role) => {
              try {
                await deleteRoleApi(role.id, { roleName: role.name });
                dispatch({
                  type: 'ROLE_DELETED',
                  roleId: role.id,
                  summary: `Deleted role '${role.name}'`,
                });
              } catch (err) {
                dispatch({
                  type: 'SAVE_FAIL',
                  message: err instanceof Error ? err.message : 'Failed to delete role',
                });
              }
            }}
          />
        </TabsContent>

        {/* ── Matrix tab ────────────────────────────────────────── */}
        <TabsContent value="matrix">
          <PermissionMatrixView
            roles={state.roles}
            permissions={state.permissionCatalog}
            selectedRole={selectedRole}
            pendingPermissions={pendingForSelected}
            onSelectRole={(id) => dispatch({ type: 'SELECT_ROLE', id })}
            onTogglePermission={(permission) => {
              if (!selectedRole) return;
              dispatch({
                type: 'TOGGLE_PERMISSION',
                roleId: selectedRole.id,
                permission,
              });
            }}
            saving={state.saving}
            hasUnsavedChanges={hasUnsavedChanges}
            onSave={handleSave}
            onReset={() =>
              selectedRole && dispatch({ type: 'RESET_PENDING', roleId: selectedRole.id })
            }
          />
        </TabsContent>

        {/* ── Users tab ─────────────────────────────────────────── */}
        <TabsContent value="users">
          <UserAssignmentGrid
            users={state.users}
            roles={state.roles}
            loading={state.usersLoading}
            search={state.userSearch}
            onSearchChange={(value) => {
              dispatch({ type: 'USERS_SEARCH', value });
              void reloadUsers(value);
            }}
            onAssign={async (user, roleIds) => {
              try {
                const updated = await assignRolesToUserApi(user.id, roleIds, {
                  userDisplayName: user.displayName,
                  previousRoleIds: user.roleIds,
                });
                dispatch({
                  type: 'USER_UPDATED',
                  user: updated,
                  summary: `Assigned ${updated.roleIds.length} role(s) to '${updated.displayName}'`,
                });
              } catch (err) {
                dispatch({
                  type: 'SAVE_FAIL',
                  message: err instanceof Error ? err.message : 'Failed to assign roles',
                });
              }
            }}
          />
        </TabsContent>
      </Tabs>

      {state.recentChanges.length > 0 && (
        <Card data-testid="recent-changes">
          <CardContent className="p-4 space-y-2">
            <h2 className="text-sm font-semibold">Recent role &amp; permission changes</h2>
            <ul className="text-sm space-y-1">
              {state.recentChanges.map((change, idx) => (
                <li key={`${change.timestamp}-${idx}`} className="text-muted-foreground">
                  <time dateTime={change.timestamp} className="mr-2">
                    {new Date(change.timestamp).toLocaleString()}
                  </time>
                  {change.summary}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Sub-views ────────────────────────────────────────────────────────────

function RolesListView({
  roles,
  selectedRoleId,
  onSelect,
  onCreate,
  onDelete,
}: {
  roles: TenantRole[];
  selectedRoleId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  onDelete: (role: TenantRole) => Promise<void>;
}): JSX.Element {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            setCreating(true);
            try {
              await onCreate(newName.trim());
              setNewName('');
            } finally {
              setCreating(false);
            }
          }}
        >
          <div className="flex-1">
            <Label htmlFor="new-role-name" className="sr-only">
              New role name
            </Label>
            <Input
              id="new-role-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New role name"
              data-testid="new-role-name"
            />
          </div>
          <Button type="submit" disabled={creating || !newName.trim()} data-testid="create-role">
            Create role
          </Button>
        </form>

        <ul className="divide-y" data-testid="roles-list">
          {roles.map((role) => (
            <li
              key={role.id}
              className={`flex items-center justify-between py-3 px-2 cursor-pointer ${
                role.id === selectedRoleId ? 'bg-accent' : ''
              }`}
              onClick={() => onSelect(role.id)}
              data-testid={`role-item-${role.id}`}
            >
              <div className="flex items-center gap-3">
                <span className="font-medium">{role.name}</span>
                {role.builtIn && <Badge variant="outline">Built-in</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {role.permissions.length} permission(s)
                </span>
                {!role.builtIn && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onDelete(role);
                    }}
                    data-testid={`delete-role-${role.id}`}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function PermissionMatrixView({
  roles,
  permissions,
  selectedRole,
  pendingPermissions,
  onSelectRole,
  onTogglePermission,
  saving,
  hasUnsavedChanges,
  onSave,
  onReset,
}: {
  roles: TenantRole[];
  permissions: RolePermission[];
  selectedRole: TenantRole | null;
  pendingPermissions: RolePermission[] | null;
  onSelectRole: (id: string) => void;
  onTogglePermission: (permission: RolePermission) => void;
  saving: boolean;
  hasUnsavedChanges: boolean;
  onSave: () => void | Promise<void>;
  onReset: () => void;
}): JSX.Element {
  if (!selectedRole) {
    return (
      <Alert>
        <AlertDescription>Select a role to edit its permissions.</AlertDescription>
      </Alert>
    );
  }

  const effectivePermissions = pendingPermissions ?? selectedRole.permissions;
  const sortedPermissions = useMemo(
    () =>
      [...permissions].sort((a, b) =>
        a.resource === b.resource
          ? a.action.localeCompare(b.action)
          : a.resource.localeCompare(b.resource),
      ),
    [permissions],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Label htmlFor="role-selector">Role</Label>
        <select
          id="role-selector"
          value={selectedRole.id}
          onChange={(e) => onSelectRole(e.target.value)}
          className="rounded border bg-background px-2 py-1"
          data-testid="role-selector"
        >
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.builtIn ? ' (built-in)' : ''}
            </option>
          ))}
        </select>
        {selectedRole.builtIn && <Badge variant="outline">Built-in role — read-only</Badge>}
        <div className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          onClick={onReset}
          disabled={!hasUnsavedChanges || saving}
          data-testid="matrix-reset"
        >
          Discard changes
        </Button>
        <Button
          type="button"
          onClick={onSave}
          disabled={!hasUnsavedChanges || saving || selectedRole.builtIn}
          data-testid="matrix-save"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>

      <div className="border rounded overflow-x-auto">
        <table className="w-full text-sm" data-testid="permission-matrix">
          <thead className="bg-muted">
            <tr>
              <th className="text-left py-2 px-3">Permission</th>
              <th className="text-center py-2 px-3">Granted</th>
            </tr>
          </thead>
          <tbody>
            {sortedPermissions.map((permission) => {
              const granted = roleHasPermission({ permissions: effectivePermissions }, permission);
              const grantedExactly = effectivePermissions.some(
                (p) => p.resource === permission.resource && p.action === permission.action,
              );
              const grantedViaWildcard = granted && !grantedExactly;
              const disabled = selectedRole.builtIn || grantedViaWildcard;
              const key = permissionKey(permission);
              return (
                <tr key={key} className="border-t hover:bg-accent/40">
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-xs">
                        {permission.resource}:{permission.action}
                      </code>
                      {grantedViaWildcard && (
                        <Badge variant="outline" className="text-xs">
                          via wildcard
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-3 text-center">
                    <Checkbox
                      checked={granted}
                      disabled={disabled}
                      onCheckedChange={() => {
                        if (!disabled) onTogglePermission(permission);
                      }}
                      aria-label={`Toggle ${permission.resource}:${permission.action} for ${selectedRole.name}`}
                      data-testid={`matrix-cell-${key}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserAssignmentGrid({
  users,
  roles,
  loading,
  search,
  onSearchChange,
  onAssign,
}: {
  users: TenantUser[];
  roles: TenantRole[];
  loading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onAssign: (user: TenantUser, roleIds: string[]) => Promise<void>;
}): JSX.Element {
  const [pending, setPending] = useState<Record<string, string[]>>({});

  return (
    <div className="space-y-4">
      <div className="flex gap-2 max-w-md">
        <Label htmlFor="user-search" className="sr-only">
          Search users
        </Label>
        <Input
          id="user-search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by name or email"
          data-testid="user-search"
        />
      </div>

      {loading ? (
        <Skeleton className="h-32 w-full" />
      ) : users.length === 0 ? (
        <Alert>
          <AlertDescription>No users match the current filter.</AlertDescription>
        </Alert>
      ) : (
        <div className="border rounded overflow-x-auto">
          <table className="w-full text-sm" data-testid="user-grid">
            <thead className="bg-muted">
              <tr>
                <th className="text-left py-2 px-3">User</th>
                <th className="text-left py-2 px-3">Email</th>
                <th className="text-left py-2 px-3">Roles</th>
                <th className="text-right py-2 px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const draft = pending[user.id] ?? user.roleIds;
                const dirty = pending[user.id] !== undefined;
                return (
                  <tr key={user.id} className="border-t" data-testid={`user-row-${user.id}`}>
                    <td className="py-2 px-3 font-medium">{user.displayName}</td>
                    <td className="py-2 px-3 text-muted-foreground">{user.email}</td>
                    <td className="py-2 px-3">
                      <div
                        className="flex flex-wrap gap-2"
                        role="group"
                        aria-label={`Roles for ${user.displayName}`}
                      >
                        {roles.map((role) => {
                          const checked = draft.includes(role.id);
                          return (
                            <label key={role.id} className="flex items-center gap-1 text-xs">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => {
                                  setPending((prev) => {
                                    const cur = prev[user.id] ?? user.roleIds;
                                    const next = checked
                                      ? cur.filter((id) => id !== role.id)
                                      : [...cur, role.id];
                                    return { ...prev, [user.id]: next };
                                  });
                                }}
                                aria-label={`Toggle ${role.name}`}
                                data-testid={`user-${user.id}-role-${role.id}`}
                              />
                              {role.name}
                            </label>
                          );
                        })}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <Button
                        type="button"
                        size="sm"
                        disabled={!dirty}
                        onClick={async () => {
                          await onAssign(user, draft);
                          setPending((prev) => {
                            const next = { ...prev };
                            delete next[user.id];
                            return next;
                          });
                        }}
                        data-testid={`save-user-${user.id}`}
                      >
                        Save
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
