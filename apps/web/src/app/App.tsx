/**
 * App.tsx — Application Root with Provider Hierarchy
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ Provider Hierarchy (Design Section A)                                   │
 * │                                                                         │
 * │ The providers are composed in this exact order so each provider can     │
 * │ read from the providers above it:                                       │
 * │                                                                         │
 * │   1. BrandConfigProvider  — tenant branding (name, logo, colors)        │
 * │   2. LanguageProvider     — i18n locale, direction, translations        │
 * │   3. ThemeProvider        — light/dark/system mode                      │
 * │   4. ConnectivityProvider — online/offline/syncing state                │
 * │   5. AuthProvider         — session, tokens, RBAC                       │
 * │   6. RouterProvider       — React Router with lazy feature modules      │
 * │                                                                         │
 * │ BrandConfig, Language, and Theme mount BEFORE Auth so that public       │
 * │ marketing pages and auth screens can render branded, themed,            │
 * │ localized UI without requiring an active session.                       │
 * │                                                                         │
 * │ Requirements: 4, 18, 36, 38, 43                                        │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import React from 'react';
import { BrandConfigProvider } from '@/providers/BrandConfigProvider';
import { LanguageProvider } from '@/providers/LanguageProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { ConnectivityProvider } from '@/providers/ConnectivityProvider';
import { AuthProvider } from '@/providers/AuthProvider';
import { FeatureFlagsProvider } from '@/providers/FeatureFlagsProvider';
import { RootRouter } from '@/RootRouter';

/**
 * The application root component.
 *
 * Composes the provider hierarchy defined in Design Section A, ensuring:
 * - BrandConfigProvider is outermost so all children can access tenant branding
 * - LanguageProvider reads brand slug for namespaced storage keys
 * - ThemeProvider reads brand slug for namespaced storage keys
 * - ConnectivityProvider is independent but placed after theme for UI consistency
 * - AuthProvider can access brand, language, theme, and connectivity state
 * - FeatureFlagsProvider sits below AuthProvider so flag resolution can read
 *   the authenticated tenant once entitlement payloads are wired in (Task 53.5)
 * - RootRouter (RouterProvider) is innermost, consuming all provider contexts
 */
export function App() {
  return (
    <BrandConfigProvider>
      <LanguageProvider>
        <ThemeProvider>
          <ConnectivityProvider>
            <AuthProvider>
              <FeatureFlagsProvider>
                <RootRouter />
              </FeatureFlagsProvider>
            </AuthProvider>
          </ConnectivityProvider>
        </ThemeProvider>
      </LanguageProvider>
    </BrandConfigProvider>
  );
}

export default App;
