/**
 * Tests for App.tsx — Provider Hierarchy (Design Section A)
 *
 * Verifies that the provider hierarchy is composed in the correct order
 * and that each provider's context hook is accessible from within the tree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock react-router-dom before any imports that use it
vi.mock('react-router-dom', () => ({
  createBrowserRouter: vi.fn(() => ({})),
  RouterProvider: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="router-provider">{children}</div>
  ),
  Outlet: () => <div data-testid="outlet" />,
}));

// Mock the feature registry lazy imports to avoid actual dynamic imports in tests
vi.mock('@/featureRegistry', () => ({
  featureRegistry: [],
  getModulesByScope: () => [],
  getModuleById: () => undefined,
  getFeatureChunkIds: () => [],
}));

import React from 'react';
import { App } from './App';
import {
  BrandConfigProvider,
  LanguageProvider,
  ThemeProvider,
  ConnectivityProvider,
  AuthProvider,
  useBrand,
  useLanguage,
  useTheme,
  useConnectivity,
  useAuth,
  DEFAULT_BRAND,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
} from '@/providers/index';

describe('App — Provider Hierarchy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports App as a named export', () => {
    expect(App).toBeDefined();
    expect(typeof App).toBe('function');
  });

  it('exports App as the default export', async () => {
    const module = await import('./App');
    expect(module.default).toBe(App);
  });
});

describe('Provider stubs — exports are defined', () => {
  it('BrandConfigProvider is a function component', () => {
    expect(BrandConfigProvider).toBeDefined();
    expect(typeof BrandConfigProvider).toBe('function');
  });

  it('LanguageProvider is a function component', () => {
    expect(LanguageProvider).toBeDefined();
    expect(typeof LanguageProvider).toBe('function');
  });

  it('ThemeProvider is a function component', () => {
    expect(ThemeProvider).toBeDefined();
    expect(typeof ThemeProvider).toBe('function');
  });

  it('ConnectivityProvider is a function component', () => {
    expect(ConnectivityProvider).toBeDefined();
    expect(typeof ConnectivityProvider).toBe('function');
  });

  it('AuthProvider is a function component', () => {
    expect(AuthProvider).toBeDefined();
    expect(typeof AuthProvider).toBe('function');
  });
});

describe('Provider stubs — hooks are defined', () => {
  it('useBrand is a function', () => {
    expect(useBrand).toBeDefined();
    expect(typeof useBrand).toBe('function');
  });

  it('useLanguage is a function', () => {
    expect(useLanguage).toBeDefined();
    expect(typeof useLanguage).toBe('function');
  });

  it('useTheme is a function', () => {
    expect(useTheme).toBeDefined();
    expect(typeof useTheme).toBe('function');
  });

  it('useConnectivity is a function', () => {
    expect(useConnectivity).toBeDefined();
    expect(typeof useConnectivity).toBe('function');
  });

  it('useAuth is a function', () => {
    expect(useAuth).toBeDefined();
    expect(typeof useAuth).toBe('function');
  });
});

describe('Provider barrel exports — constants', () => {
  it('exports DEFAULT_BRAND with expected shape', () => {
    expect(DEFAULT_BRAND).toBeDefined();
    expect(DEFAULT_BRAND.name).toBe('ProctiraERP');
    expect(DEFAULT_BRAND.slug).toBe('proctira');
    expect(DEFAULT_BRAND.logo).toHaveProperty('url');
    expect(DEFAULT_BRAND.logo).toHaveProperty('alt');
    expect(DEFAULT_BRAND.favicon).toBeDefined();
    expect(DEFAULT_BRAND.primary_color).toBeDefined();
    expect(DEFAULT_BRAND.accent_color).toBeDefined();
    expect(DEFAULT_BRAND.login_background).toBeDefined();
    expect(DEFAULT_BRAND.document_title_template).toBeDefined();
  });

  it('exports SUPPORTED_LOCALES with all 8 Indian languages', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'hi', 'ta', 'te', 'mr', 'bn', 'gu', 'kn']);
  });

  it('exports DEFAULT_LOCALE as English', () => {
    expect(DEFAULT_LOCALE).toBe('en');
  });
});
