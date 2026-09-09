'use client';

/**
 * G-910 — working controls for the tenant admin console (previously inert
 * buttons): invite user, edit user roles, suspend/reactivate, create/edit/
 * delete custom roles, and save tenant settings.
 */
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Pencil, Plus, Trash2, UserMinus, UserPlus } from 'lucide-react';

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@proctira/ui/components';
import {
  createRoleAction,
  deleteRoleAction,
  inviteUserAction,
  saveTenantSettingsAction,
  setUserRolesAction,
  setUserStatusAction,
  updateRoleAction,
  type AdminActionState,
} from '@/app/(dashboard)/admin/actions';
import type {
  PermissionRef,
  TenantRole,
  TenantSettings,
  TenantUser,
} from '@/lib/api/admin.server';

function Feedback({ state }: { state: AdminActionState | null }) {
  if (!state || state.status === 'idle') return null;
  return (
    <div className="space-y-1">
      <p
        role={state.status === 'error' ? 'alert' : 'status'}
        className={
          state.status === 'error' ? 'text-sm text-destructive' : 'text-sm text-emerald-700'
        }
      >
        {state.message}
      </p>
      {state.fieldErrors &&
        Object.entries(state.fieldErrors).map(([field, message]) => (
          <p key={field} className="text-xs text-destructive">
            {field}: {message}
          </p>
        ))}
    </div>
  );
}

function RoleChecklist({
  roles,
  selected,
  onChange,
}: {
  roles: TenantRole[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Roles</legend>
      {roles.length === 0 ? (
        <p className="text-xs text-muted-foreground">No roles available.</p>
      ) : (
        roles.map((role) => {
          const checked = selected.includes(role.id);
          return (
            <label key={role.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={checked}
                onCheckedChange={(value) =>
                  onChange(
                    value ? [...selected, role.id] : selected.filter((id) => id !== role.id),
                  )
                }
                aria-label={role.name}
              />
              {role.name}
              {role.builtIn ? <span className="text-xs text-muted-foreground">(built-in)</span> : null}
            </label>
          );
        })
      )}
    </fieldset>
  );
}

// ─── Users ───────────────────────────────────────────────────────────────────

export function InviteUserDialog({ roles }: { roles: TenantRole[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AdminActionState | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const res = await inviteUserAction({
        email: String(formData.get('email') ?? '').trim(),
        displayName: String(formData.get('displayName') ?? '').trim(),
        roleIds: selected,
      });
      setState(res);
      if (res.status === 'success') {
        setOpen(false);
        setSelected([]);
        router.refresh();
      }
    });
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} data-testid="invite-user">
        <UserPlus className="me-1.5 h-4 w-4" aria-hidden="true" />
        Invite user
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-hydrated="true">
          <form action={onSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Invite user</DialogTitle>
              <DialogDescription>
                The account is created in the INVITED state; roles can be changed later.
              </DialogDescription>
            </DialogHeader>
            <Feedback state={state} />
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">E-mail</Label>
              <Input id="invite-email" name="email" type="email" required autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-name">Full name</Label>
              <Input id="invite-name" name="displayName" required maxLength={200} />
            </div>
            <RoleChecklist roles={roles} selected={selected} onChange={setSelected} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Send invite
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function UserRowActions({ user, roles }: { user: TenantUser; roles: TenantRole[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AdminActionState | null>(null);
  const [selected, setSelected] = useState<string[]>(user.roleIds);
  const [isPending, startTransition] = useTransition();

  const saveRoles = () => {
    startTransition(async () => {
      const res = await setUserRolesAction(user.id, selected);
      setState(res);
      if (res.status === 'success') {
        setOpen(false);
        router.refresh();
      }
    });
  };

  const toggleStatus = () => {
    const next = user.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    if (
      next === 'SUSPENDED' &&
      !window.confirm(`Suspend ${user.email}? They will lose access immediately.`)
    ) {
      return;
    }
    startTransition(async () => {
      const res = await setUserStatusAction(user.id, next);
      setState(res);
      if (res.status === 'success') router.refresh();
    });
  };

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Edit roles for ${user.email}`}
        data-testid={`edit-user-${user.email}`}
      >
        <Pencil className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
        Roles
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleStatus}
        disabled={isPending}
        aria-label={`${user.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'} ${user.email}`}
        data-testid={`toggle-status-${user.email}`}
      >
        {user.status === 'SUSPENDED' ? (
          <>
            <Check className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Reactivate
          </>
        ) : (
          <>
            <UserMinus className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Suspend
          </>
        )}
      </Button>
      {state?.status === 'error' && !open ? (
        <span role="alert" className="text-xs text-destructive">
          {state.message}
        </span>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-hydrated="true">
          <DialogHeader>
            <DialogTitle>Roles for {user.displayName}</DialogTitle>
            <DialogDescription>{user.email}</DialogDescription>
          </DialogHeader>
          <Feedback state={state} />
          <RoleChecklist roles={roles} selected={selected} onChange={setSelected} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveRoles} disabled={isPending}>
              {isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Save roles
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Roles ───────────────────────────────────────────────────────────────────

const permKey = (p: PermissionRef) => `${p.resource}:${p.action}`;

export interface RoleEditorDialogProps {
  catalog: PermissionRef[];
  role?: TenantRole;
  triggerLabel?: string;
  triggerVariant?: 'default' | 'outline' | 'ghost';
}

export function RoleEditorDialog({
  catalog,
  role,
  triggerLabel,
  triggerVariant = 'default',
}: RoleEditorDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AdminActionState | null>(null);
  const [granted, setGranted] = useState<Set<string>>(
    () => new Set((role?.permissions ?? []).map(permKey)),
  );
  const [isPending, startTransition] = useTransition();

  const byResource = useMemo(() => {
    const map = new Map<string, PermissionRef[]>();
    for (const p of catalog) {
      const list = map.get(p.resource) ?? [];
      list.push(p);
      map.set(p.resource, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [catalog]);

  const toggle = (p: PermissionRef, value: boolean) => {
    setGranted((prev) => {
      const next = new Set(prev);
      if (value) next.add(permKey(p));
      else next.delete(permKey(p));
      return next;
    });
  };

  const toggleResource = (perms: PermissionRef[], value: boolean) => {
    setGranted((prev) => {
      const next = new Set(prev);
      for (const p of perms) {
        if (value) next.add(permKey(p));
        else next.delete(permKey(p));
      }
      return next;
    });
  };

  const onSubmit = (formData: FormData) => {
    const permissions = catalog.filter((p) => granted.has(permKey(p)));
    const description = String(formData.get('description') ?? '').trim();
    const input = {
      name: String(formData.get('name') ?? '').trim(),
      description: description.length > 0 ? description : null,
      permissions,
    };
    startTransition(async () => {
      const res = role ? await updateRoleAction(role.id, input) : await createRoleAction(input);
      setState(res);
      if (res.status === 'success') {
        setOpen(false);
        router.refresh();
      }
    });
  };

  const isEdit = Boolean(role);
  const label = triggerLabel ?? (isEdit ? 'Edit' : 'Create role');

  return (
    <>
      <Button
        size="sm"
        variant={triggerVariant}
        onClick={() => setOpen(true)}
        disabled={role?.builtIn}
        title={role?.builtIn ? 'Built-in roles cannot be edited' : undefined}
        data-testid={isEdit ? `edit-role-${role!.name}` : 'create-role'}
      >
        {isEdit ? (
          <Pencil className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
        )}
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-hydrated="true">
          <form action={onSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{isEdit ? `Edit role: ${role!.name}` : 'Create custom role'}</DialogTitle>
              <DialogDescription>
                Grant permissions per module. Users holding this role get the union of all their
                roles.
              </DialogDescription>
            </DialogHeader>
            <Feedback state={state} />
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Role name</Label>
              <Input
                id="role-name"
                name="name"
                required
                minLength={2}
                maxLength={100}
                defaultValue={role?.name ?? ''}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-description">Description</Label>
              <Textarea
                id="role-description"
                name="description"
                rows={2}
                maxLength={500}
                defaultValue={role?.description ?? ''}
              />
            </div>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">
                Permissions{' '}
                <span className="text-muted-foreground">({granted.size} granted)</span>
              </legend>
              {byResource.length === 0 ? (
                <p className="text-xs text-muted-foreground">Permission catalog unavailable.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {byResource.map(([resource, perms]) => {
                    const all = perms.every((p) => granted.has(permKey(p)));
                    return (
                      <div key={resource} className="rounded-md border p-2.5">
                        <label className="flex items-center gap-2 text-sm font-semibold">
                          <Checkbox
                            checked={all}
                            onCheckedChange={(v) => toggleResource(perms, Boolean(v))}
                            aria-label={`All ${resource} permissions`}
                          />
                          {resource}
                        </label>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 ps-6">
                          {perms.map((p) => (
                            <label
                              key={permKey(p)}
                              className="flex items-center gap-1.5 text-xs text-muted-foreground"
                            >
                              <Checkbox
                                checked={granted.has(permKey(p))}
                                onCheckedChange={(v) => toggle(p, Boolean(v))}
                                aria-label={permKey(p)}
                              />
                              {p.action}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || granted.size === 0}>
                {isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {isEdit ? 'Save role' : 'Create role'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeleteRoleButton({ role }: { role: TenantRole }) {
  const router = useRouter();
  const [state, setState] = useState<AdminActionState | null>(null);
  const [isPending, startTransition] = useTransition();
  if (role.builtIn) return null;

  const onDelete = () => {
    if (!window.confirm(`Delete role "${role.name}"? Users holding it will lose those grants.`)) {
      return;
    }
    startTransition(async () => {
      const res = await deleteRoleAction(role.id);
      setState(res);
      if (res.status === 'success') router.refresh();
    });
  };

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        disabled={isPending}
        aria-label={`Delete role ${role.name}`}
        data-testid={`delete-role-${role.name}`}
      >
        <Trash2 className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
        Delete
      </Button>
      {state?.status === 'error' ? (
        <span role="alert" className="text-xs text-destructive">
          {state.message}
        </span>
      ) : null}
    </span>
  );
}

// ─── Tenant settings ─────────────────────────────────────────────────────────

function optional(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? '').trim();
  return s.length > 0 ? s : null;
}

export function TenantSettingsForm({ settings }: { settings: TenantSettings }) {
  const router = useRouter();
  const [state, setState] = useState<AdminActionState | null>(null);
  const [isPending, startTransition] = useTransition();

  const onSubmit = (formData: FormData) => {
    const supportedLocales = String(formData.get('supportedLocales') ?? '')
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    startTransition(async () => {
      const res = await saveTenantSettingsAction({
        displayName: String(formData.get('displayName') ?? '').trim(),
        defaultLocale: String(formData.get('defaultLocale') ?? '').trim(),
        supportedLocales,
        timezone: String(formData.get('timezone') ?? '').trim(),
        academicYearStartMonth: Number(formData.get('academicYearStartMonth') ?? 0),
        branding: {
          primaryColor: String(formData.get('primaryColor') ?? '').trim(),
          accentColor: String(formData.get('accentColor') ?? '').trim(),
          logoUrl: optional(formData.get('logoUrl')),
        },
        contact: {
          email: optional(formData.get('contactEmail')),
          phone: optional(formData.get('contactPhone')),
        },
      });
      setState(res);
      if (res.status === 'success') router.refresh();
    });
  };

  const field = (id: string, label: string, input: React.ReactNode, hint?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {input}
      {state?.fieldErrors?.[id] ? (
        <p className="text-xs text-destructive">{state.fieldErrors[id]}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );

  return (
    <form id="tenant-config-form" action={onSubmit} className="space-y-6" data-hydrated="true">
      <Feedback state={state} />
      <section className="max-w-[860px] space-y-4 rounded-xl border bg-card p-5">
        <div>
          <h2 className="text-base font-semibold">Identity</h2>
          <p className="text-xs text-muted-foreground">
            Tenant ID <code className="rounded bg-muted px-1.5 py-0.5">{settings.tenantId}</code>
            {settings.updatedAt ? ` · last saved ${new Date(settings.updatedAt).toLocaleString()}` : ''}
          </p>
        </div>
        {field(
          'displayName',
          'Display name',
          <Input id="displayName" name="displayName" required defaultValue={settings.displayName} />,
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {field(
            'defaultLocale',
            'Default locale',
            <Input
              id="defaultLocale"
              name="defaultLocale"
              required
              defaultValue={settings.defaultLocale}
              placeholder="en"
            />,
          )}
          {field(
            'supportedLocales',
            'Supported locales',
            <Input
              id="supportedLocales"
              name="supportedLocales"
              required
              defaultValue={settings.supportedLocales.join(', ')}
              placeholder="en, hi, ta"
            />,
            'Comma-separated; must include the default locale.',
          )}
          {field(
            'timezone',
            'Timezone',
            <Input id="timezone" name="timezone" required defaultValue={settings.timezone} />,
            'IANA name, e.g. Asia/Kolkata.',
          )}
          {field(
            'academicYearStartMonth',
            'Academic year starts in month',
            <Input
              id="academicYearStartMonth"
              name="academicYearStartMonth"
              type="number"
              min={1}
              max={12}
              required
              defaultValue={settings.academicYearStartMonth}
            />,
            '1 = January … 12 = December.',
          )}
        </div>
      </section>

      <section className="max-w-[860px] space-y-4 rounded-xl border bg-card p-5">
        <div>
          <h2 className="text-base font-semibold">Branding</h2>
          <p className="text-xs text-muted-foreground">Theme colours and logo for this tenant.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {field(
            'primaryColor',
            'Primary colour',
            <Input
              id="primaryColor"
              name="primaryColor"
              required
              defaultValue={settings.branding.primaryColor}
              placeholder="#1d4ed8"
            />,
          )}
          {field(
            'accentColor',
            'Accent colour',
            <Input
              id="accentColor"
              name="accentColor"
              required
              defaultValue={settings.branding.accentColor}
              placeholder="#0ea5e9"
            />,
          )}
        </div>
        {field(
          'logoUrl',
          'Logo URL',
          <Input
            id="logoUrl"
            name="logoUrl"
            type="url"
            defaultValue={settings.branding.logoUrl ?? ''}
            placeholder="https://example.com/logo.svg"
          />,
        )}
      </section>

      <section className="max-w-[860px] space-y-4 rounded-xl border bg-card p-5">
        <div>
          <h2 className="text-base font-semibold">Contact</h2>
          <p className="text-xs text-muted-foreground">
            Public contact details surfaced in support flows.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {field(
            'contactEmail',
            'E-mail',
            <Input
              id="contactEmail"
              name="contactEmail"
              type="email"
              defaultValue={settings.contact.email ?? ''}
            />,
          )}
          {field(
            'contactPhone',
            'Phone',
            <Input id="contactPhone" name="contactPhone" defaultValue={settings.contact.phone ?? ''} />,
          )}
        </div>
      </section>

      <div className="flex max-w-[860px] justify-end">
        <Button type="submit" disabled={isPending} data-testid="save-tenant-settings">
          {isPending ? (
            <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="me-1.5 h-4 w-4" aria-hidden="true" />
          )}
          Save changes
        </Button>
      </div>
    </form>
  );
}
