'use client';

/**
 * Client provider stack shared by every App Router route group.
 *
 * The root `layout.tsx` (a Server Component) mounts `BrandConfigProvider` and
 * `LanguageProvider`; this component supplies the remaining client-side
 * providers — theme, connectivity, auth, and feature flags — in the same nesting
 * order as the SPA shell (`src/app/App.tsx`). Without it, dashboard chrome that
 * calls `useTheme()` / `useAuth()` throws "must be used within a <Provider>".
 */
import type { ReactNode } from 'react';

import { AuthProvider } from '@/providers/AuthProvider';
import { ConnectivityProvider } from '@/providers/ConnectivityProvider';
import { FeatureFlagsProvider } from '@/providers/FeatureFlagsProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ConnectivityProvider>
        <AuthProvider>
          <FeatureFlagsProvider>{children}</FeatureFlagsProvider>
        </AuthProvider>
      </ConnectivityProvider>
    </ThemeProvider>
  );
}
