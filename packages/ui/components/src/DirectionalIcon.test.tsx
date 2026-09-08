/**
 * @vitest-environment jsdom
 *
 * DirectionalIcon tests — Task 48.3 / Requirements 18.7, 18.10, 18.11
 *
 * Covers:
 *   • LTR: no horizontal flip is applied
 *   • RTL: a horizontal-flip class is applied so the icon mirrors visually
 *   • Implicit `dir` is read from `document.documentElement.dir`
 *   • Consumer-supplied props (className, data-*, aria-*) are forwarded
 *   • Refs forward to the underlying <svg>
 *   • Non-directional icons still work via the wrapper but the convention
 *     is to bypass it (verified via doc-only assertion that the prop API
 *     is the same shape as a plain lucide-react component)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { ArrowRight, Calendar, ChevronLeft, ChevronRight, Search, User } from 'lucide-react';

import { DirectionalIcon } from './DirectionalIcon';

beforeEach(() => {
  document.documentElement.removeAttribute('dir');
});

afterEach(() => {
  document.documentElement.removeAttribute('dir');
});

describe('<DirectionalIcon> — LTR (default direction)', () => {
  it('does not apply the flip class when dir="ltr" is passed explicitly', () => {
    const { container } = render(
      <DirectionalIcon icon={ChevronRight} dir="ltr" data-testid="icon" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.classList.contains('-scale-x-100')).toBe(false);
    expect(svg?.getAttribute('data-rtl-flipped')).toBeNull();
  });

  it('does not flip when document.dir is unset (server-default)', () => {
    const { container } = render(<DirectionalIcon icon={ChevronRight} />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('-scale-x-100')).toBe(false);
  });
});

describe('<DirectionalIcon> — RTL behaviour (Requirement 18.10, 18.11)', () => {
  it('applies the -scale-x-100 utility when dir="rtl" is passed', () => {
    const { container } = render(<DirectionalIcon icon={ChevronRight} dir="rtl" />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('-scale-x-100')).toBe(true);
    expect(svg?.getAttribute('data-rtl-flipped')).toBe('true');
  });

  it('mirrors arrow icons (ArrowRight) when dir="rtl"', () => {
    const { container } = render(<DirectionalIcon icon={ArrowRight} dir="rtl" />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('-scale-x-100')).toBe(true);
  });

  it('mirrors ChevronLeft (the inverse direction) consistently — flipping is purely about the document direction', () => {
    // The wrapper does not "know" which way the icon points; it simply
    // mirrors when the doc is RTL. Authors are expected to pick the
    // forward-pointing icon (ChevronRight) and let the wrapper handle
    // the rest.
    const { container } = render(<DirectionalIcon icon={ChevronLeft} dir="rtl" />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('-scale-x-100')).toBe(true);
  });

  it('reads `document.documentElement.dir` when no `dir` prop is supplied', () => {
    document.documentElement.dir = 'rtl';
    const { container } = render(<DirectionalIcon icon={ChevronRight} />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('-scale-x-100')).toBe(true);
  });
});

describe('<DirectionalIcon> — prop forwarding', () => {
  it('forwards className and merges with the flip utility', () => {
    const { container } = render(
      <DirectionalIcon icon={ChevronRight} dir="rtl" className="h-5 w-5 text-primary" />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('-scale-x-100')).toBe(true);
    expect(svg?.classList.contains('h-5')).toBe(true);
    expect(svg?.classList.contains('w-5')).toBe(true);
    expect(svg?.classList.contains('text-primary')).toBe(true);
  });

  it('forwards aria-* and data-* attributes to the underlying <svg>', () => {
    const { container } = render(
      <DirectionalIcon icon={ChevronRight} dir="ltr" aria-hidden="true" data-testid="next-arrow" />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('data-testid')).toBe('next-arrow');
  });

  it('forwards a ref to the rendered <svg>', () => {
    const ref = React.createRef<SVGSVGElement>();
    render(<DirectionalIcon ref={ref} icon={ChevronRight} dir="ltr" />);
    expect(ref.current).toBeInstanceOf(SVGElement);
  });

  it('lets consumers override the size via lucide props', () => {
    const { container } = render(<DirectionalIcon icon={ChevronRight} dir="ltr" size={32} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('32');
    expect(svg?.getAttribute('height')).toBe('32');
  });
});

describe('<DirectionalIcon> — non-directional icon convention (documentation)', () => {
  // These tests exist as executable documentation: the wrapper *can* render
  // any lucide icon, but per the contract above, direction-neutral icons
  // (Search, User, Calendar) MUST bypass the wrapper to avoid mirroring
  // them in RTL contexts. We verify the wrapper *would* mirror them — the
  // test reminds future maintainers why we don't pass them through here.
  it('would mirror Search if (mistakenly) wrapped — author should bypass the wrapper', () => {
    const { container } = render(<DirectionalIcon icon={Search} dir="rtl" />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('-scale-x-100')).toBe(true);
  });

  it('would mirror Calendar / User the same way — author should bypass the wrapper', () => {
    const cal = render(<DirectionalIcon icon={Calendar} dir="rtl" />);
    const usr = render(<DirectionalIcon icon={User} dir="rtl" />);
    expect(cal.container.querySelector('svg')?.classList.contains('-scale-x-100')).toBe(true);
    expect(usr.container.querySelector('svg')?.classList.contains('-scale-x-100')).toBe(true);
  });
});
