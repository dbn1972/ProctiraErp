/**
 * @vitest-environment jsdom
 *
 * <DocumentTitle> tests — Task 57.2 / Requirement 43 AC 5–6
 *
 * Covers:
 *   • Resolves `{page}` and `{brand}` placeholders (default template).
 *   • Falls back to bare `pageTitle` while the brand boot fetch is loading.
 *   • Honours a tenant-supplied template (e.g. `"{brand} — {page}"`).
 *   • Honours a per-render `template` prop override.
 *   • Re-applies the title when `pageTitle` changes (every navigation).
 *   • `resolveDocumentTitle()` is exported pure and works without a DOM.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import React from 'react';

import {
  BrandConfigProvider,
  DEFAULT_BRAND,
  clearBrandCache,
  type Brand,
  type BrandFetcher,
} from '@/providers/BrandConfigProvider';
import { DocumentTitle, resolveDocumentTitle } from './DocumentTitle';

// ─── Helpers ──────────────────────────────────────────────────────────────

const SAMPLE_BRAND: Brand = {
  name: 'EduZo',
  shortName: 'eduzo',
  slug: 'eduzo',
  logo: { url: 'https://cdn.example.test/eduzo/logo.svg', alt: 'EduZo' },
  favicon: 'https://cdn.example.test/eduzo/favicon.ico',
  primary_color: 'hsl(280, 70%, 45%)',
  accent_color: 'hsl(40, 90%, 55%)',
  login_background: 'linear-gradient(135deg, hsl(280, 70%, 30%), hsl(280, 70%, 50%))',
  document_title_template: '{page} · {brand}',
};

beforeEach(() => {
  clearBrandCache();
  document.title = '';
});

// ─── resolveDocumentTitle (pure helper) ───────────────────────────────────

describe('resolveDocumentTitle', () => {
  it('substitutes {page} and {brand} into the default template', () => {
    expect(resolveDocumentTitle('{page} | {brand}', 'Dashboard', 'ProctiraERP')).toBe(
      'Dashboard | ProctiraERP',
    );
  });

  it('honours a tenant-supplied template with custom separator', () => {
    expect(resolveDocumentTitle('{brand} — {page}', 'Track', 'EduZo')).toBe('EduZo — Track');
  });

  it('falls back to the Design §M default when template is empty', () => {
    expect(resolveDocumentTitle('', 'Dashboard', 'ProctiraERP')).toBe('Dashboard | ProctiraERP');
    expect(resolveDocumentTitle(undefined, 'Dashboard', 'ProctiraERP')).toBe(
      'Dashboard | ProctiraERP',
    );
  });

  it('returns just the page title when brand name is missing', () => {
    expect(resolveDocumentTitle('{page} | {brand}', 'Dashboard', '')).toBe('Dashboard |');
    expect(resolveDocumentTitle('', 'Dashboard', '')).toBe('Dashboard');
  });

  it('falls back to default joining when the template has no placeholders', () => {
    // Misconfigured template (no `{page}` / `{brand}`) → treat as default.
    expect(resolveDocumentTitle('Static Title', 'Dashboard', 'ProctiraERP')).toBe(
      'Dashboard | ProctiraERP',
    );
  });
});

// ─── <DocumentTitle> integration ──────────────────────────────────────────

function renderWith(brand: Brand | undefined, node: React.ReactNode) {
  return render(<BrandConfigProvider initialBrand={brand}>{node}</BrandConfigProvider>);
}

describe('<DocumentTitle> with brand', () => {
  it('sets document.title using the tenant template', async () => {
    renderWith(SAMPLE_BRAND, <DocumentTitle pageTitle="Track Application" />);
    await waitFor(() => {
      expect(document.title).toBe('Track Application · EduZo');
    });
  });

  it('uses the canonical Design §M default for the ProctiraERP brand', async () => {
    renderWith(DEFAULT_BRAND, <DocumentTitle pageTitle="Dashboard" />);
    await waitFor(() => {
      expect(document.title).toBe('Dashboard | ProctiraERP');
    });
  });

  it('re-applies the title when the page title changes (navigation)', async () => {
    const { rerender } = renderWith(DEFAULT_BRAND, <DocumentTitle pageTitle="Dashboard" />);
    await waitFor(() => {
      expect(document.title).toBe('Dashboard | ProctiraERP');
    });

    rerender(
      <BrandConfigProvider initialBrand={DEFAULT_BRAND}>
        <DocumentTitle pageTitle="Institutions" />
      </BrandConfigProvider>,
    );
    await waitFor(() => {
      expect(document.title).toBe('Institutions | ProctiraERP');
    });
  });

  it('honours a per-render template override', async () => {
    renderWith(DEFAULT_BRAND, <DocumentTitle pageTitle="Login" template="{brand} :: {page}" />);
    await waitFor(() => {
      expect(document.title).toBe('ProctiraERP :: Login');
    });
  });
});

describe('<DocumentTitle> while brand is loading', () => {
  it('falls back to the bare page title until the fetch resolves', async () => {
    let resolveBrand: (b: Brand) => void = () => {};
    const fetcher: BrandFetcher = () =>
      new Promise<Brand>((resolve) => {
        resolveBrand = resolve;
      });

    render(
      <BrandConfigProvider fetcher={fetcher}>
        <DocumentTitle pageTitle="Track Application" />
      </BrandConfigProvider>,
    );

    // While the fetcher is still pending, the tab is unbranded.
    await waitFor(() => {
      expect(document.title).toBe('Track Application');
    });

    await act(async () => {
      resolveBrand(SAMPLE_BRAND);
    });

    // Once the brand resolves, the template is applied.
    await waitFor(() => {
      expect(document.title).toBe('Track Application · EduZo');
    });
  });
});
