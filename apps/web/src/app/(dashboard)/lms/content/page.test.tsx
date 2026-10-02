/**
 * @vitest-environment jsdom
 *
 * PRC-H024 / PRC-H033 — a content item of kind 'link' renders its body through
 * safeHref: http(s) becomes a new-tab link, anything else (legacy
 * `javascript:` rows) stays inert text. Text bodies are never linkified.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentItem } from '@/lib/api/lms';

let items: ContentItem[] = [];

vi.mock('@/lib/api/lms', () => ({ listContentItems: async () => items }));
vi.mock('@/lib/load-entity-labels', () => ({ loadInstitutionOptions: async () => [] }));
vi.mock('../_components/content-form', () => ({ ContentForm: () => null }));
vi.mock('../_components/lms-subnav', () => ({ LmsSubnav: () => null }));

import LmsContentPage from './page';

function item(overrides: Partial<ContentItem>): ContentItem {
  return {
    id: 'c1',
    title: 'Resource',
    kind: 'link',
    body: null,
    tags: [],
    classKey: null,
    subject: null,
    published: true,
    ...overrides,
  };
}

afterEach(() => cleanup());

describe('LMS content library rendering', () => {
  it('renders an http(s) link body as a safe new-tab anchor', async () => {
    items = [item({ body: 'https://example.edu/notes' })];
    render(await LmsContentPage());
    const link = screen.getByRole('link', { name: /example\.edu\/notes/ });
    expect(link.getAttribute('href')).toBe('https://example.edu/notes');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('renders a javascript: link body as inert text, not an anchor', async () => {
    items = [item({ body: 'javascript:alert(1)' })];
    const { container } = render(await LmsContentPage());
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByTestId('lms-resource-unsafe-url').textContent).toContain(
      'javascript:alert(1)',
    );
  });

  it('never linkifies a text body even if it looks like a URL', async () => {
    items = [item({ kind: 'text', body: 'https://example.edu' })];
    const { container } = render(await LmsContentPage());
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('https://example.edu')).toBeTruthy();
  });
});
