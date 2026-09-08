import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { RolePicker } from './RolePicker';

/**
 * Validates Task 49.2 — the shared `<RolePicker>` renders the supplied
 * tenant role catalog, switches into a loading-disabled state while the
 * catalog is being fetched, and forwards `aria-invalid` so the parent
 * form can flag validation errors.
 */

const ROLES = [
  { id: 'principal', label: 'Principal', requiresApproval: true },
  { id: 'teacher', label: 'Teacher', requiresApproval: true },
  { id: 'student', label: 'Student', requiresApproval: false },
];

describe('<RolePicker />', () => {
  it('disables the trigger while loading and shows the loading placeholder', () => {
    render(
      <RolePicker
        value=""
        onValueChange={() => {}}
        roles={[]}
        loading
        placeholder="Select your role"
        loadingPlaceholder="Loading roles…"
      />,
    );
    const trigger = screen.getByTestId('role-picker');
    expect(trigger).toBeDisabled();
    // The Radix `<SelectValue>` renders the placeholder when no value is
    // selected; the visible text reflects the loading copy.
    expect(trigger.textContent).toContain('Loading roles…');
  });

  it('renders the placeholder when no role is selected', () => {
    render(
      <RolePicker value="" onValueChange={() => {}} roles={ROLES} placeholder="Select your role" />,
    );
    expect(screen.getByTestId('role-picker').textContent).toContain('Select your role');
  });

  it('forwards aria-invalid and aria-describedby for error wiring', () => {
    render(
      <RolePicker
        value=""
        onValueChange={() => {}}
        roles={ROLES}
        placeholder="Select your role"
        ariaInvalid
        ariaDescribedBy="role-error-msg"
      />,
    );
    const trigger = screen.getByTestId('role-picker');
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(trigger).toHaveAttribute('aria-describedby', 'role-error-msg');
  });

  it('renders the supplied label when one is provided', () => {
    render(
      <RolePicker
        value=""
        onValueChange={() => {}}
        roles={ROLES}
        placeholder="Select your role"
        label="Your role"
      />,
    );
    expect(screen.getByText('Your role')).toBeInTheDocument();
  });

  it('respects the disabled prop independently of loading', () => {
    render(
      <RolePicker
        value=""
        onValueChange={() => {}}
        roles={ROLES}
        disabled
        placeholder="Select your role"
      />,
    );
    expect(screen.getByTestId('role-picker')).toBeDisabled();
  });
});
