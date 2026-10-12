/**
 * @vitest-environment jsdom
 *
 * PRC-M139: the parent and student portal shells must expose an account
 * control that signs the user out via the POST logout path (not a GET link).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const signOut = vi.fn();

vi.mock('next/navigation', () => ({ usePathname: () => '/parent' }));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@/providers/BrandConfigProvider', () => ({
  useBrand: () => ({ name: 'Test School', brand: { name: 'Test School' }, loading: false }),
}));
vi.mock('@/lib/auth', () => ({ signOut: (...args: unknown[]) => signOut(...args) }));

import { ParentPortalShell } from './ParentPortalShell';
import { StudentPortalShell } from './StudentPortalShell';

beforeEach(() => {
  document.body.innerHTML = '';
  signOut.mockReset();
});

describe('portal shell sign-out (PRC-M139)', () => {
  it('ParentPortalShell exposes a sign-out button that calls signOut (POST)', () => {
    render(
      <ParentPortalShell>
        <main>Child content</main>
      </ParentPortalShell>,
    );
    const button = screen.getByTestId('parent-shell-signout');
    expect(button.tagName).toBe('BUTTON');
    fireEvent.click(button);
    expect(signOut).toHaveBeenCalledWith('/login');
  });

  it('StudentPortalShell exposes a sign-out button that calls signOut (POST)', () => {
    render(
      <StudentPortalShell>
        <main>Child content</main>
      </StudentPortalShell>,
    );
    const button = screen.getByTestId('student-shell-signout');
    expect(button.tagName).toBe('BUTTON');
    fireEvent.click(button);
    expect(signOut).toHaveBeenCalledWith('/login');
  });
});
