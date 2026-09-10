'use client';

import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * `Toaster` — global Sonner toast surface used by `<sonner />` callers
 * such as `toast.success(…)`. Mount once at the application root.
 *
 * Ported from `School Platform Design/src/app/components/ui/sonner.tsx`
 * during task 60.1. The reference port relies on `next-themes` to mirror
 * the theme; we keep that integration optional so apps without
 * `next-themes` can still consume the component.
 */
export const Toaster = ({ ...props }: ToasterProps) => {
  // Apps that ship `next-themes` will receive a synced theme value; in
  // its absence we fall back to "system" so Sonner picks the OS pref.
  // We resolve `next-themes` lazily through `globalThis` so this package
  // does not hard-require the optional peer dependency.
  let theme: ToasterProps['theme'] = 'system';
  const dynamicRequire =
    (globalThis as unknown as { require?: (id: string) => unknown }).require ?? null;
  if (dynamicRequire) {
    try {
      const nextThemes = dynamicRequire('next-themes') as
        | { useTheme?: () => { theme?: string } }
        | undefined;
      const useTheme = nextThemes?.useTheme;
      if (useTheme) {
        const { theme: t } = useTheme();
        if (t) theme = t as ToasterProps['theme'];
      }
    } catch {
      // next-themes not installed; keep system default.
    }
  }

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
