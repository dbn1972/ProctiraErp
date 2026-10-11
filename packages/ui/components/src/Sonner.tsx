'use client';

import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * `Toaster` — global Sonner toast surface used by `<sonner />` callers
 * such as `toast.success(…)`. Mount once at the application root.
 *
 * Ported from `School Platform Design/src/app/components/ui/sonner.tsx`
 * during task 60.1.
 *
 * PRC-L593: the previous port resolved `next-themes` through
 * `globalThis.require` and called `useTheme()` conditionally inside a
 * try/if — a Rules-of-Hooks violation that also never worked in browser/ESM
 * bundles (where `globalThis.require` is undefined), so toasts were always
 * rendered with the `"system"` theme. The theme is now a plain prop: apps
 * that use `next-themes` pass `theme={useTheme().theme}` (or render a thin
 * `ThemedToaster` wrapper), keeping this package free of the optional peer
 * dependency and free of conditional hooks.
 */
export const Toaster = ({ theme = 'system', ...props }: ToasterProps) => {
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
};
