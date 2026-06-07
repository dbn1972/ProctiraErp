/**
 * @vitest-environment jsdom
 *
 * Unit tests for CommandPalette (Task 60A.7).
 *
 * Validates:
 *   - ⌘K / Ctrl+K opens the palette
 *   - Ctrl+K toggles the palette closed
 *   - Navigation items from featureRegistry are rendered
 *   - RBAC filtering shows only items the user has permissions for
 *   - Selecting an item navigates to the correct route
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      email: 'admin@test.com',
      name: 'Admin',
      roles: ['admin'],
      permissions: ['institution.read', 'student.read', 'staff.read'],
      scope: { level: 'country' as const },
      tenant_id: 'tenant-1',
    },
    status: 'authenticated' as const,
    isAuthenticated: true,
    signIn: vi.fn(),
    signOut: vi.fn(),
    refreshToken: vi.fn(),
    accessToken: 'mock-token',
  }),
}));

vi.mock('@proctira/ui/components', () => {
  // Minimal mock of the Command primitives for testing
  const CommandDialog = ({
    children,
    open,
    onOpenChange: _onOpenChange,
  }: {
    children: React.ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => {
    if (!open) return null;
    return (
      <div data-testid="command-dialog" role="dialog">
        {children}
      </div>
    );
  };

  const CommandInput = (props: { placeholder?: string }) => (
    <input data-testid="command-input" placeholder={props.placeholder} />
  );

  const CommandList = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="command-list">{children}</div>
  );

  const CommandEmpty = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="command-empty">{children}</div>
  );

  const CommandGroup = ({
    children,
    heading,
  }: {
    children: React.ReactNode;
    heading?: string;
  }) => (
    <div data-testid="command-group" data-heading={heading}>
      {children}
    </div>
  );

  const CommandItem = ({
    children,
    onSelect,
    value,
    ...props
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
    value?: string;
    'data-testid'?: string;
  }) => (
    <div
      data-testid={props['data-testid']}
      data-value={value}
      onClick={onSelect}
      role="option"
    >
      {children}
    </div>
  );

  const CommandShortcut = ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  );

  const CommandSeparator = () => <hr />;

  const useAnnounce = () => vi.fn();

  return {
    CommandDialog,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
    CommandShortcut,
    CommandSeparator,
    useAnnounce,
  };
});

// ─── Import after mocks ───────────────────────────────────────────────────────

import { CommandPalette } from './CommandPalette';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CommandPalette', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('does not render the dialog when closed', () => {
    render(<CommandPalette />);
    expect(screen.queryByTestId('command-dialog')).toBeNull();
  });

  it('opens on Ctrl+K', () => {
    render(<CommandPalette />);

    act(() => {
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    });

    expect(screen.queryByTestId('command-dialog')).not.toBeNull();
  });

  it('opens on ⌘K (Meta+K)', () => {
    render(<CommandPalette />);

    act(() => {
      fireEvent.keyDown(document, { key: 'k', metaKey: true });
    });

    expect(screen.queryByTestId('command-dialog')).not.toBeNull();
  });

  it('closes when toggled again with Ctrl+K', () => {
    render(<CommandPalette />);

    // Open
    act(() => {
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    });
    expect(screen.queryByTestId('command-dialog')).not.toBeNull();

    // Close
    act(() => {
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    });
    expect(screen.queryByTestId('command-dialog')).toBeNull();
  });

  it('renders navigation items the user has permissions for', () => {
    render(<CommandPalette />);

    act(() => {
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    });

    // User has institution.read, student.read, staff.read
    expect(screen.queryByTestId('command-palette-item-institutions')).not.toBeNull();
    expect(screen.queryByTestId('command-palette-item-students')).not.toBeNull();
    expect(screen.queryByTestId('command-palette-item-staff')).not.toBeNull();
  });

  it('renders items with no required permissions (dashboard, help)', () => {
    render(<CommandPalette />);

    act(() => {
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    });

    expect(screen.queryByTestId('command-palette-item-dashboard')).not.toBeNull();
    expect(screen.queryByTestId('command-palette-item-help')).not.toBeNull();
  });

  it('navigates to the correct route when an item is selected', () => {
    render(<CommandPalette />);

    act(() => {
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    });

    const item = screen.getByTestId('command-palette-item-institutions');
    act(() => {
      fireEvent.click(item);
    });

    expect(mockPush).toHaveBeenCalledWith('/app/institutions');
  });

  it('closes the dialog after navigation', () => {
    render(<CommandPalette />);

    act(() => {
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    });
    expect(screen.queryByTestId('command-dialog')).not.toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId('command-palette-item-dashboard'));
    });

    expect(screen.queryByTestId('command-dialog')).toBeNull();
  });

  it('does not open on plain K key without modifier', () => {
    render(<CommandPalette />);

    act(() => {
      fireEvent.keyDown(document, { key: 'k' });
    });

    expect(screen.queryByTestId('command-dialog')).toBeNull();
  });
});
