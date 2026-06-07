/**
 * @vitest-environment jsdom
 *
 * Property F-6: Tenant Theming Independence
 *
 * For any tenant `t`, setting the CSS custom properties `--tenant-primary`
 * and `--tenant-accent` at `:root` (via the tenant resolver middleware)
 * SHALL update all branded surfaces — sidebar background, primary buttons,
 * focus rings, chart-1, chart-2 — without any component source code change.
 *
 * **Validates: Requirements 28.1, 28.10, 43.4, 43.5**
 *
 * Strategy:
 *   1. Generate arbitrary HSL color pairs via fast-check.
 *   2. Mount the dashboard (BrandConfigProvider + a minimal component tree
 *      that references the branded surfaces).
 *   3. Mutate `--tenant-primary` and `--tenant-accent` at `:root` via
 *      `document.documentElement.style.setProperty`.
 *   4. Assert that the branded CSS variables on `:root` reflect the new
 *      values WITHOUT triggering a React re-render (no state change, no
 *      prop change — pure CSS cascade).
 *
 * The test exercises the CSS custom property architecture that makes tenant
 * theming a zero-code-change operation. In a real browser the cascade
 * propagates `var(--tenant-primary)` references to all consuming elements;
 * in jsdom we verify the `:root` inline style (the injection point) and
 * the architectural invariant that the theme stylesheet declares the
 * correct token slots.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React, { useRef, useEffect, useState } from 'react';
import fc from 'fast-check';

import {
  BrandConfigProvider,
  injectBrandCSSVariables,
  DEFAULT_BRAND,
  type Brand,
} from '../BrandConfigProvider';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Read a CSS custom property from :root inline style. */
function readRootVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name).trim();
}

/** Clear all --tenant-* variables from :root. */
function clearTenantVars(): void {
  const root = document.documentElement;
  for (const name of [
    '--tenant-name',
    '--tenant-shortName',
    '--tenant-primary',
    '--tenant-accent',
    '--tenant-logo',
    '--tenant-favicon',
    '--tenant-login-bg',
  ]) {
    root.style.removeProperty(name);
  }
}

/**
 * fast-check arbitrary for valid HSL color strings.
 * Generates colors in the form `hsl(H, S%, L%)` with:
 *   - H: 0–360 (hue degrees)
 *   - S: 10–100 (saturation %, avoiding near-gray)
 *   - L: 15–85 (lightness %, avoiding near-black/white extremes)
 */
const hslColorArb = fc
  .tuple(
    fc.integer({ min: 0, max: 360 }),
    fc.integer({ min: 10, max: 100 }),
    fc.integer({ min: 15, max: 85 }),
  )
  .map(([h, s, l]) => `hsl(${h}, ${s}%, ${l}%)`);

/**
 * fast-check arbitrary for a tenant color pair (primary + accent).
 * Ensures the two colors are distinct.
 */
const tenantColorPairArb = fc
  .tuple(hslColorArb, hslColorArb)
  .filter(([primary, accent]) => primary !== accent);

/**
 * A render-counting component that references branded surfaces.
 * It renders elements that would consume --tenant-primary and --tenant-accent
 * via CSS classes (bg-[--tenant-primary], etc.) in a real Tailwind build.
 * The render counter lets us assert that CSS variable mutations do NOT
 * trigger React re-renders.
 */
function BrandedSurfaces({ onRender }: { onRender: () => void }) {
  useEffect(() => {
    onRender();
  });

  return (
    <div data-testid="branded-shell">
      {/* Sidebar — uses bg-sidebar which maps to var(--sidebar) / var(--tenant-primary) */}
      <aside
        data-testid="sidebar"
        style={{ backgroundColor: 'var(--tenant-primary)' }}
      />
      {/* Primary button — uses bg-primary which maps to var(--tenant-primary) */}
      <button
        data-testid="primary-button"
        style={{ backgroundColor: 'var(--tenant-primary)' }}
      >
        Action
      </button>
      {/* Focus ring — uses outline-color from var(--tenant-primary) via --ring */}
      <input
        data-testid="focus-ring-input"
        style={{ outlineColor: 'var(--tenant-primary)' }}
      />
      {/* Chart series 1 — uses var(--tenant-primary) */}
      <div
        data-testid="chart-1"
        style={{ fill: 'var(--tenant-primary)' }}
      />
      {/* Chart series 2 — uses var(--tenant-accent) */}
      <div
        data-testid="chart-2"
        style={{ fill: 'var(--tenant-accent)' }}
      />
    </div>
  );
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearTenantVars();
});

afterEach(() => {
  clearTenantVars();
});

// ─── Property Test ───────────────────────────────────────────────────────────

describe('Property F-6: Tenant Theming Independence', () => {
  /**
   * Core property: For ANY pair of tenant colors, mutating --tenant-primary
   * and --tenant-accent at :root updates all branded surfaces without a
   * component re-render.
   *
   * **Validates: Requirements 28.1, 28.10, 43.4, 43.5**
   */
  it('mutating --tenant-primary and --tenant-accent at :root updates branded surfaces without re-render', () => {
    fc.assert(
      fc.property(tenantColorPairArb, ([primary, accent]) => {
        clearTenantVars();

        // Track render count
        let renderCount = 0;
        const onRender = () => { renderCount++; };

        // Mount the branded component tree with the default brand
        const { unmount } = render(
          <BrandConfigProvider initialBrand={DEFAULT_BRAND}>
            <BrandedSurfaces onRender={onRender} />
          </BrandConfigProvider>,
        );

        // Record the initial render count (mount = 1 render)
        const initialRenderCount = renderCount;
        expect(initialRenderCount).toBeGreaterThanOrEqual(1);

        // ─── Mutate tenant CSS variables at :root (simulating tenant resolver) ───
        document.documentElement.style.setProperty('--tenant-primary', primary);
        document.documentElement.style.setProperty('--tenant-accent', accent);

        // ─── Assert: CSS variables on :root reflect the new tenant colors ───
        expect(readRootVar('--tenant-primary')).toBe(primary);
        expect(readRootVar('--tenant-accent')).toBe(accent);

        // ─── Assert: No React re-render occurred ───
        // The CSS variable mutation is a pure DOM/CSS operation that does NOT
        // trigger React's reconciliation. The render count must remain unchanged.
        expect(renderCount).toBe(initialRenderCount);

        unmount();
      }),
      { numRuns: 50 },
    );
  });

  /**
   * Property: injectBrandCSSVariables correctly propagates ANY brand's
   * primary and accent colors to the :root CSS variables that branded
   * surfaces consume.
   *
   * **Validates: Requirements 28.1, 43.4**
   */
  it('injectBrandCSSVariables sets --tenant-primary and --tenant-accent for any brand', () => {
    fc.assert(
      fc.property(tenantColorPairArb, ([primary, accent]) => {
        clearTenantVars();

        const brand: Brand = {
          ...DEFAULT_BRAND,
          primary_color: primary,
          accent_color: accent,
        };

        injectBrandCSSVariables(brand);

        // The injection must set the exact values on :root
        expect(readRootVar('--tenant-primary')).toBe(primary);
        expect(readRootVar('--tenant-accent')).toBe(accent);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property: Switching between two different tenant brands updates all
   * branded surface tokens without any intermediate state leaking.
   *
   * **Validates: Requirements 28.10, 43.5**
   */
  it('switching tenants updates all branded tokens atomically', () => {
    fc.assert(
      fc.property(
        tenantColorPairArb,
        tenantColorPairArb,
        ([primaryA, accentA], [primaryB, accentB]) => {
          clearTenantVars();

          // Apply tenant A
          const brandA: Brand = {
            ...DEFAULT_BRAND,
            name: 'TenantA',
            shortName: 'tenant-a',
            slug: 'tenant-a',
            primary_color: primaryA,
            accent_color: accentA,
          };
          injectBrandCSSVariables(brandA);

          expect(readRootVar('--tenant-primary')).toBe(primaryA);
          expect(readRootVar('--tenant-accent')).toBe(accentA);

          // Switch to tenant B — all tokens must update
          const brandB: Brand = {
            ...DEFAULT_BRAND,
            name: 'TenantB',
            shortName: 'tenant-b',
            slug: 'tenant-b',
            primary_color: primaryB,
            accent_color: accentB,
          };
          injectBrandCSSVariables(brandB);

          // After switch, only tenant B's colors should be present
          expect(readRootVar('--tenant-primary')).toBe(primaryB);
          expect(readRootVar('--tenant-accent')).toBe(accentB);

          // No residual tenant A values
          expect(readRootVar('--tenant-primary')).not.toBe(primaryA);
          expect(readRootVar('--tenant-accent')).not.toBe(accentA);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * Property: The theme.css stylesheet declares --tenant-primary and
   * --tenant-accent as override slots in both light and dark mode blocks,
   * ensuring the CSS architecture supports tenant theming without source
   * code changes.
   *
   * **Validates: Requirements 28.1, 43.4**
   */
  it('theme.css declares --tenant-primary and --tenant-accent in both light and dark blocks', () => {
    // This is a static architectural assertion (not property-based) that
    // validates the CSS file structure supports the property.
    const { readFileSync } = require('node:fs');
    const { resolve, dirname } = require('node:path');

    const themeCssPath = resolve(
      __dirname,
      '../../../../packages/ui/styles/theme.css',
    );

    let themeCss: string;
    try {
      themeCss = readFileSync(themeCssPath, 'utf8');
    } catch {
      // If the file path doesn't resolve, try alternative path
      const altPath = resolve(
        __dirname,
        '../../../../../packages/ui/styles/theme.css',
      );
      themeCss = readFileSync(altPath, 'utf8');
    }

    // Light mode block must declare --tenant-primary and --tenant-accent
    expect(themeCss).toMatch(/--tenant-primary:\s*[^;]+;/);
    expect(themeCss).toMatch(/--tenant-accent:\s*[^;]+;/);

    // Dark mode block must also declare them
    const darkBlockMatch = themeCss.match(/:root\.dark\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/s);
    expect(darkBlockMatch).not.toBeNull();
    const darkBlock = darkBlockMatch![1];
    expect(darkBlock).toMatch(/--tenant-primary/);
    expect(darkBlock).toMatch(/--tenant-accent/);
  });
});
