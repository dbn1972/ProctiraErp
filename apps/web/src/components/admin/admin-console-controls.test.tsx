/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/(dashboard)/admin/actions', () => ({
  createRoleAction: vi.fn(),
  deleteRoleAction: vi.fn(),
  inviteUserAction: vi.fn(),
  setUserRolesAction: vi.fn(),
  setUserStatusAction: vi.fn(),
  updateRoleAction: vi.fn(),
  saveTenantSettingsAction: vi.fn(),
}));

import { RoleEditorDialog, UserRowActions } from './admin-console-controls';

const roles = [
  { id: 'r1', name: 'Teacher', builtIn: false, permissions: [] },
  { id: 'r2', name: 'Clerk', builtIn: false, permissions: [] },
] as never;

function isChecked(name: string): boolean {
  return screen.getByRole('checkbox', { name }).getAttribute('aria-checked') === 'true';
}

describe('admin dialogs discard unsaved selection (PRC-L257)', () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
    Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
  });

  it('user roles: toggle, cancel, reopen restores the original selection', () => {
    render(
      <UserRowActions
        user={{
          id: 'u1',
          email: 'a@example.test',
          displayName: 'A',
          status: 'ACTIVE',
          roleIds: ['r1'],
        }}
        roles={roles}
      />,
    );
    fireEvent.click(screen.getByTestId('edit-user-a@example.test'));
    expect(isChecked('Teacher')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Clerk' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Teacher' }));
    expect(isChecked('Clerk')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByTestId('edit-user-a@example.test'));
    expect(isChecked('Teacher')).toBe(true);
    expect(isChecked('Clerk')).toBe(false);
  });

  it('role editor: toggled permission is discarded on cancel', () => {
    const catalog = [{ resource: 'students', action: 'read' }] as never;
    render(<RoleEditorDialog catalog={catalog} />);
    fireEvent.click(screen.getByTestId('create-role'));
    const before = screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-checked'));
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByTestId('create-role'));
    const after = screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-checked'));
    expect(after).toEqual(before);
  });
});
