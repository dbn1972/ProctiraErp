/**
 * @vitest-environment jsdom
 *
 * <RolesPermissions> matrix toggle + audit-event tests (Task 59.3).
 *
 * Verifies the page wires the admin client correctly:
 *   • The matrix renders rows for every entry returned by
 *     `listPermissionCatalog` and columns for every role returned by
 *     `listTenantRoles`.
 *   • Built-in roles are read-only — checkboxes are disabled and a
 *     `(read-only)` badge appears.
 *   • Toggling a checkbox for a custom role and clicking "Save changes"
 *     calls `updateRolePermissions` with the new permission set, which in
 *     turn dispatches a high-risk audit event.
 *   • Validates Requirements 42.4, 42.5, 33.4 (high-risk audit event on every
 *     change).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Stub Radix UI's ResizeObserver requirement under jsdom.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
}
// Radix UI's pointer + scroll handlers expect these to exist on Element.
const proto = Element.prototype as unknown as Record<string, unknown>;
if (!('hasPointerCapture' in proto)) {
  proto['hasPointerCapture'] = () => false;
}
if (!('releasePointerCapture' in proto)) {
  proto['releasePointerCapture'] = () => undefined;
}
if (!('scrollIntoView' in proto)) {
  proto['scrollIntoView'] = () => undefined;
}

// Mock the admin API client BEFORE importing the page so the page picks up
// the spies. The mocks all behave like the real implementation: they
// resolve with the supplied fixtures.
vi.mock('@/lib/api/admin', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/admin')>('@/lib/api/admin');
  return {
    ...actual,
    listTenantRoles: vi.fn(),
    listPermissionCatalog: vi.fn(),
    listTenantUsers: vi.fn(),
    createRole: vi.fn(),
    updateRolePermissions: vi.fn(),
    deleteRole: vi.fn(),
    assignRolesToUser: vi.fn(),
  };
});

import * as adminApi from '@/lib/api/admin';
import RolesPermissions from './RolesPermissions';
import type { TenantRole, RolePermission } from '@/lib/api/admin';

const BUILTIN_ROLE: TenantRole = {
  id: 'role-builtin',
  name: 'Administrator',
  description: null,
  builtIn: true,
  permissions: [{ resource: 'institution', action: 'manage' }],
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

const CUSTOM_ROLE: TenantRole = {
  id: 'role-custom',
  name: 'Curriculum Lead',
  description: null,
  builtIn: false,
  permissions: [{ resource: 'student', action: 'read' }],
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

const PERMISSIONS: RolePermission[] = [
  { resource: 'student', action: 'read' },
  { resource: 'student', action: 'create' },
  { resource: 'institution', action: 'manage' },
];

beforeEach(() => {
  vi.mocked(adminApi.listTenantRoles).mockResolvedValue([BUILTIN_ROLE, CUSTOM_ROLE]);
  vi.mocked(adminApi.listPermissionCatalog).mockResolvedValue(PERMISSIONS);
  vi.mocked(adminApi.listTenantUsers).mockResolvedValue({
    data: [],
    meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Switches to the named tab using the keyboard. Radix's onClick on a
 * `<TabsTrigger>` only fires when the trigger receives a real pointer
 * event (it filters out synthetic clicks under jsdom). Arrow-key
 * navigation, however, exercises the roving-focus group cleanly — and is
 * a more accessible interaction to assert in any case (Requirement 37 AC 6).
 */
function activateTab(name: RegExp): void {
  const tabs = screen.getAllByRole('tab');
  const target = tabs.find((t) => name.test(t.textContent ?? ''));
  if (!target) throw new Error(`No tab matching ${name}`);
  // Focus the currently-active tab, then arrow over until we land on the target.
  const active = tabs.find((t) => t.getAttribute('data-state') === 'active') ?? tabs[0]!;
  act(() => {
    active.focus();
  });
  let cursor = active;
  let safety = tabs.length + 1;
  while (cursor !== target && safety-- > 0) {
    act(() => {
      fireEvent.keyDown(cursor, { key: 'ArrowRight', code: 'ArrowRight' });
    });
    cursor = (document.activeElement as HTMLElement | null) ?? cursor;
  }
}

describe('<RolesPermissions>', () => {
  it('renders a matrix row for each permission and columns reflect role state', async () => {
    render(<RolesPermissions />);

    // Wait for initial load — the page swaps the loading skeleton for the real content.
    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    });

    // Switch to the matrix tab.
    activateTab(/permission matrix/i);

    // Default selection is the first role (Administrator — built-in).
    const roleSelector = await screen.findByTestId('role-selector');
    expect((roleSelector as HTMLSelectElement).value).toBe(BUILTIN_ROLE.id);

    // Built-in role banner is visible.
    expect(screen.getByText(/Built-in role — read-only/i)).toBeTruthy();

    // Save button is disabled for built-in roles.
    expect((screen.getByTestId('matrix-save') as HTMLButtonElement).disabled).toBe(true);

    // Permission rows are rendered.
    expect(screen.getByTestId('matrix-cell-student::read')).toBeTruthy();
    expect(screen.getByTestId('matrix-cell-student::create')).toBeTruthy();
    expect(screen.getByTestId('matrix-cell-institution::manage')).toBeTruthy();
  });

  it('toggling a permission on a custom role and saving dispatches a high-risk audit event', async () => {
    const updatedRole: TenantRole = {
      ...CUSTOM_ROLE,
      permissions: [
        { resource: 'student', action: 'read' },
        { resource: 'student', action: 'create' },
      ],
    };
    vi.mocked(adminApi.updateRolePermissions).mockResolvedValue(updatedRole);

    render(<RolesPermissions />);

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    });

    // Switch to matrix tab.
    activateTab(/permission matrix/i);

    // Switch to the custom role.
    const selector = await screen.findByTestId('role-selector');
    act(() => {
      fireEvent.change(selector, { target: { value: CUSTOM_ROLE.id } });
    });

    // Toggle "student:create" on (currently off because CUSTOM_ROLE only has student:read).
    const createCheckbox = screen.getByTestId('matrix-cell-student::create');
    act(() => {
      fireEvent.click(createCheckbox);
    });

    // Save button is now enabled.
    const saveBtn = screen.getByTestId('matrix-save') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(saveBtn);
    });

    // The client API was called with the updated permission list, the role
    // metadata for audit context, and nothing else.
    expect(adminApi.updateRolePermissions).toHaveBeenCalledTimes(1);
    const [roleId, payload, context] = vi.mocked(adminApi.updateRolePermissions).mock
      .calls[0]!;
    expect(roleId).toBe(CUSTOM_ROLE.id);
    expect(payload.permissions).toEqual([
      { resource: 'student', action: 'read' },
      { resource: 'student', action: 'create' },
    ]);
    expect(context).toEqual({
      roleName: CUSTOM_ROLE.name,
      previousPermissions: CUSTOM_ROLE.permissions,
    });

    // Success message + recent change appear once the save succeeds.
    await waitFor(() => {
      expect(screen.queryByTestId('save-success')).not.toBeNull();
      expect(screen.queryByTestId('recent-changes')).not.toBeNull();
    });

    // Recent change list shows the new entry.
    expect(screen.getByTestId('recent-changes').textContent).toContain(
      `Updated permissions on role '${CUSTOM_ROLE.name}'`,
    );
  });

  it('disables checkboxes for permissions covered by a wildcard grant', async () => {
    const wildcardRole: TenantRole = {
      ...CUSTOM_ROLE,
      permissions: [{ resource: '*', action: 'manage' }],
    };
    vi.mocked(adminApi.listTenantRoles).mockResolvedValue([wildcardRole]);

    render(<RolesPermissions />);

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    });

    activateTab(/permission matrix/i);

    // Every catalog entry is granted via wildcard, so no checkbox is editable.
    const checkbox = (await screen.findByTestId('matrix-cell-student::read')) as HTMLButtonElement;
    expect(checkbox.disabled).toBe(true);
    // The "via wildcard" badge surfaces the reason — sanity-check at least one row.
    expect(screen.getAllByText(/via wildcard/i).length).toBeGreaterThan(0);
  });

  it('reset button discards pending matrix edits without calling the API', async () => {
    render(<RolesPermissions />);
    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    });

    activateTab(/permission matrix/i);

    const selector = await screen.findByTestId('role-selector');
    act(() => {
      fireEvent.change(selector, { target: { value: CUSTOM_ROLE.id } });
    });

    const createCheckbox = screen.getByTestId('matrix-cell-student::create');
    act(() => fireEvent.click(createCheckbox));

    expect((screen.getByTestId('matrix-save') as HTMLButtonElement).disabled).toBe(false);

    act(() => fireEvent.click(screen.getByTestId('matrix-reset')));

    expect((screen.getByTestId('matrix-save') as HTMLButtonElement).disabled).toBe(true);
    expect(adminApi.updateRolePermissions).not.toHaveBeenCalled();
  });
});
