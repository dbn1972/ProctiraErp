import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Button, buttonVariants } from './Button';

/**
 * Validates Task 56.3 (Requirement 37 AC 3): every interactive variant of
 * the canonical shadcn/ui <Button> primitive must enforce a 48 × 48 px
 * minimum activation area and 12 px gap between adjacent inline children
 * (typically an icon and its label).
 */

const SIZES = ['default', 'sm', 'lg', 'icon'] as const;
const VARIANTS = [
  'default',
  'destructive',
  'outline',
  'secondary',
  'ghost',
  'link',
] as const;

describe('<Button /> — touch-target floor (Req 37.3, task 56.3)', () => {
  it.each(SIZES)(
    'size="%s" includes min-h-[48px], min-w-[48px], and gap-3',
    (size) => {
      render(
        <Button size={size} aria-label={`button-${size}`}>
          label
        </Button>,
      );
      const el = screen.getByRole('button', { name: `button-${size}` });
      expect(el.className).toContain('min-h-[48px]');
      expect(el.className).toContain('min-w-[48px]');
      expect(el.className).toContain('gap-3');
    },
  );

  it.each(VARIANTS)(
    'variant="%s" includes min-h-[48px], min-w-[48px], and gap-3',
    (variant) => {
      render(
        <Button variant={variant} aria-label={`button-${variant}`}>
          label
        </Button>,
      );
      const el = screen.getByRole('button', { name: `button-${variant}` });
      expect(el.className).toContain('min-h-[48px]');
      expect(el.className).toContain('min-w-[48px]');
      expect(el.className).toContain('gap-3');
    },
  );

  it('keeps the size variant chrome (h-12 / w-12 / p-0 for icon) so the visual layout is preserved', () => {
    const classes = buttonVariants({ size: 'icon' });
    expect(classes).toContain('h-12');
    expect(classes).toContain('w-12');
    expect(classes).toContain('p-0');
    // And the touch-target floor still applies via the base layer.
    expect(classes).toContain('min-h-[48px]');
    expect(classes).toContain('min-w-[48px]');
  });

  it('keeps the small size chrome (px-3) so existing dense layouts render unchanged', () => {
    const classes = buttonVariants({ size: 'sm' });
    expect(classes).toContain('px-3');
    // sm still floors at 48 × 48 px — touch target is an a11y rule, not visual.
    expect(classes).toContain('h-12');
    expect(classes).toContain('min-h-[48px]');
    expect(classes).toContain('min-w-[48px]');
  });

  it('default and lg sizes use h-12 (48 px) so the markup matches the rendered box', () => {
    expect(buttonVariants({ size: 'default' })).toContain('h-12');
    expect(buttonVariants({ size: 'lg' })).toContain('h-12');
  });

  it('default variant + default size still renders the touch-target floor', () => {
    render(<Button>hello</Button>);
    const el = screen.getByRole('button', { name: 'hello' });
    expect(el.className).toContain('min-h-[48px]');
    expect(el.className).toContain('min-w-[48px]');
    expect(el.className).toContain('gap-3');
  });

  it('forwards a className override without dropping the touch-target floor', () => {
    render(
      <Button className="custom-class" aria-label="custom">
        x
      </Button>,
    );
    const el = screen.getByRole('button', { name: 'custom' });
    expect(el).toHaveClass('custom-class');
    expect(el.className).toContain('min-h-[48px]');
    expect(el.className).toContain('min-w-[48px]');
  });
});
