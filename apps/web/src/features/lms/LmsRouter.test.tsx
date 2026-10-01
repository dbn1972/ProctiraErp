import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LmsRouter from './LmsRouter';

describe('LmsRouter (PRC-L073)', () => {
  const original = window.location;
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });

  function stubReplace() {
    const replace = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, replace },
    });
    return replace;
  }

  it('redirects a known sub-route exactly once, after render', () => {
    const replace = stubReplace();
    render(
      <MemoryRouter initialEntries={['/pal']}>
        <LmsRouter />
      </MemoryRouter>,
    );
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/lms/pal');
    expect(screen.getByRole('link', { name: '/lms/pal' })).toBeInTheDocument();
  });

  it('sends unknown sub-routes to /lms', () => {
    const replace = stubReplace();
    render(
      <MemoryRouter initialEntries={['/nope']}>
        <LmsRouter />
      </MemoryRouter>,
    );
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/lms');
  });
});
