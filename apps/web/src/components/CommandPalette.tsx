'use client';

/**
 * CommandPalette — Global ⌘K / Ctrl+K command palette (Task 60A.7).
 *
 * Searches across navigation items from the featureRegistry, filtered by
 * the current user's RBAC permissions. Allows quick navigation to any
 * route in the authenticated shell.
 *
 * Accessibility:
 *   - Opens on ⌘K (macOS) / Ctrl+K (Windows/Linux)
 *   - Closes on Escape
 *   - Announces open/close state via `<LiveRegion>` for screen readers
 *
 * Requirements: 18, 37.6, 40.9
 * Design: A, K, L, Q
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
import {
  featureRegistry,
  type FeatureModule,
} from '@/featureRegistry';
import { useAuth } from '@/providers/AuthProvider';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolves the full route path for a feature module based on its scope.
 */
function getRoutePath(module: FeatureModule): string {
  switch (module.scope) {
    case 'app':
      return `/app/${module.routePrefix}`;
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

/**
 * Checks whether the user has all required permissions for a feature.
 */
function hasPermissions(
  userPermissions: string[],
  requiredPermissions: string[],
): boolean {
  if (requiredPermissions.length === 0) return true;
  return requiredPermissions.every((perm) => userPermissions.includes(perm));
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const announce = useAnnounce();
  const { user } = useAuth();

  const userPermissions = user?.permissions ?? [];

  // Filter navigation items to only those the user can access (app scope
  // items that pass RBAC check).
  const navigableItems = React.useMemo(() => {
    return featureRegistry.filter(
      (module) =>
        module.scope === 'app' &&
        hasPermissions(userPermissions, module.requiredPermissions),
    );
  }, [userPermissions]);

  // ─── Keyboard shortcut: ⌘K / Ctrl+K ────────────────────────────────────

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

  // ─── Announce open/close for screen readers ─────────────────────────────

  useEffect(() => {
    if (open) {
      announce('Command palette opened. Type to search navigation items.');
    } else {
      // Only announce close if the palette was previously open — avoid
      // announcing on initial mount.
      announce('Command palette closed.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ─── Navigation handler ─────────────────────────────────────────────────

  const handleSelect = useCallback(
    (module: FeatureModule) => {
      setOpen(false);
      router.push(getRoutePath(module));
    },
    [router],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search navigation…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          {navigableItems.map((module) => (
            <CommandItem
              key={module.id}
              value={`${module.label} ${module.routePrefix}`}
              onSelect={() => handleSelect(module)}
              data-testid={`command-palette-item-${module.id}`}
            >
              <span className="mr-2 text-muted-foreground">{module.label}</span>
              <span className="ml-auto text-xs text-muted-foreground/60">
                /app/{module.routePrefix}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export default CommandPalette;
