import { act } from '@testing-library/react';
import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useReducedMotion } from './useReducedMotion';

function Probe() {
  const reduce = useReducedMotion();
  return <span data-testid="probe">{reduce ? 'reduced' : 'full'}</span>;
}

const original = window.matchMedia;
const setMatchMedia = (value: unknown) =>
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value });

describe('useReducedMotion SSR + hydrate (PRC-L523)', () => {
  afterEach(() => {
    setMatchMedia(original);
    vi.restoreAllMocks();
  });

  it('hydrates without mismatch when the client prefers reduced motion', async () => {
    // Server render: no matchMedia available.
    setMatchMedia(undefined);
    const html = renderToString(<Probe />);
    expect(html).toContain('full');

    // Client: OS reports reduce.
    setMatchMedia(
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recoverable = vi.fn();

    await act(async () => {
      hydrateRoot(container, <Probe />, { onRecoverableError: recoverable });
    });

    expect(recoverable).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    // Effect applies the real preference after hydration.
    expect(container.textContent).toBe('reduced');
    container.remove();
  });
});
