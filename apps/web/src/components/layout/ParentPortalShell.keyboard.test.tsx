/**
 * @vitest-environment jsdom
 *
 * W2-A11Y-01 residual: parent portal chrome exposes a labelled nav landmark
 * and keeps primary destinations in the natural tab order.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/parent',
}));

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
  useBrand: () => ({ name: 'ProctiraERP', brand: { name: 'ProctiraERP' }, loading: false }),
}));

import { ParentPortalShell } from './ParentPortalShell';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('ParentPortalShell keyboard / landmark contract (W2-A11Y-01)', () => {
  it('exposes a navigation landmark with focusable parent destinations', () => {
    render(
      <ParentPortalShell>
        <main>Child content</main>
      </ParentPortalShell>,
    );
    const navs = screen.getAllByRole('navigation', { name: 'Parent portal navigation' });
    expect(navs.length).toBeGreaterThanOrEqual(1);
    const links = Array.from(navs[0]!.querySelectorAll('a'));
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) {
      expect(link.getAttribute('href')?.startsWith('/parent')).toBe(true);
      expect(link.tabIndex === -1).toBe(false);
    }
  });
});
