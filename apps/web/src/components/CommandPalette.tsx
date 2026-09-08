'use client';

/**
 * CommandPalette — Global ⌘K / Ctrl+K command palette (Task 60A.7 + G-406).
 *
 * Searches across navigation items from the featureRegistry plus campus
 * App Router deep links, filtered by the current user's RBAC permissions.
 *
 * Accessibility:
 *   - Opens on ⌘K (macOS) / Ctrl+K (Windows/Linux)
 *   - Closes on Escape
 *   - Announces open/close state via `<LiveRegion>` for screen readers
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  useAnnounce,
} from '@proctira/ui/components';
import { featureRegistry, type FeatureModule } from '@/featureRegistry';
import { useAuth } from '@/providers/AuthProvider';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export interface PaletteNavItem {
  id: string;
  label: string;
  href: string;
  requiredPermissions: string[];
  group: 'Navigation' | 'Campus';
}

/**
 * Resolves the full route path for a feature module based on its scope.
 * App-scope modules use App Router paths (no `/app` prefix) — G-404/G-406.
 */
export function getRoutePath(module: FeatureModule): string {
  switch (module.scope) {
    case 'app':
      if (module.routePrefix === 'dashboard' || module.routePrefix === '') {
        return '/';
      }
      return `/${module.routePrefix}`;
    case 'mobile':
      return `/mobile/${module.routePrefix}`;
    case 'auth':
      return `/auth/${module.routePrefix}`;
    case 'public':
      return `/${module.routePrefix}`;
    default:
      return `/${module.routePrefix}`;
  }
}

/** Campus modules mounted under Next.js `(dashboard)` (G-406). */
export const CAMPUS_PALETTE_LINKS: readonly PaletteNavItem[] = [
  { id: 'fees', label: 'Fees', href: '/fees', requiredPermissions: [], group: 'Campus' },
  { id: 'hostel', label: 'Hostel', href: '/hostel', requiredPermissions: [], group: 'Campus' },
  {
    id: 'transport',
    label: 'Transport',
    href: '/transport',
    requiredPermissions: [],
    group: 'Campus',
  },
  { id: 'library', label: 'Library', href: '/library', requiredPermissions: [], group: 'Campus' },
  {
    id: 'communication',
    label: 'Communication',
    href: '/communication',
    requiredPermissions: [],
    group: 'Campus',
  },
  {
    id: 'admissions',
    label: 'Admissions',
    href: '/admissions',
    requiredPermissions: [],
    group: 'Campus',
  },
] as const;

/**
 * Checks whether the user has all required permissions for a feature.
 */
function hasPermissions(userPermissions: string[], requiredPermissions: string[]): boolean {
  if (requiredPermissions.length === 0) return true;
  return requiredPermissions.every((perm) => userPermissions.includes(perm));
}

export function buildPaletteItems(userPermissions: string[]): PaletteNavItem[] {
  const fromRegistry: PaletteNavItem[] = featureRegistry
    .filter(
      (module) =>
        module.scope === 'app' && hasPermissions(userPermissions, module.requiredPermissions),
    )
    .map((module) => ({
      id: module.id,
      label: module.label,
      href: getRoutePath(module),
      requiredPermissions: module.requiredPermissions,
      group: 'Navigation' as const,
    }));

  const campus = CAMPUS_PALETTE_LINKS.filter((item) =>
    hasPermissions(userPermissions, item.requiredPermissions),
  );

  // De-dupe by href (registry may already include overlapping labels).
  const seen = new Set(fromRegistry.map((i) => i.href));
  const merged = [...fromRegistry];
  for (const item of campus) {
    if (!seen.has(item.href)) {
      merged.push(item);
      seen.add(item.href);
    }
  }
  return merged;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const announce = useAnnounce();
  const { user } = useAuth();

  const userPermissions = user?.permissions ?? [];
  const navigableItems = React.useMemo(() => buildPaletteItems(userPermissions), [userPermissions]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      announce('Command palette opened. Type to search navigation items.');
    } else {
      announce('Command palette closed.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSelect = useCallback(
    (item: PaletteNavItem) => {
      setOpen(false);
      router.push(item.href);
    },
    [router],
  );

  const navigationItems = navigableItems.filter((i) => i.group === 'Navigation');
  const campusItems = navigableItems.filter((i) => i.group === 'Campus');

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search navigation…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          {navigationItems.map((item) => (
            <CommandItem
              key={item.id}
              value={`${item.label} ${item.href}`}
              onSelect={() => handleSelect(item)}
              data-testid={`command-palette-item-${item.id}`}
            >
              <span className="mr-2 text-muted-foreground">{item.label}</span>
              <span className="ml-auto text-xs text-muted-foreground/60">{item.href}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        {campusItems.length > 0 ? (
          <CommandGroup heading="Campus">
            {campusItems.map((item) => (
              <CommandItem
                key={item.id}
                value={`${item.label} ${item.href}`}
                onSelect={() => handleSelect(item)}
                data-testid={`command-palette-item-${item.id}`}
              >
                <span className="mr-2 text-muted-foreground">{item.label}</span>
                <span className="ml-auto text-xs text-muted-foreground/60">{item.href}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

export default CommandPalette;
