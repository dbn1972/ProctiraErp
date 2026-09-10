'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from './lib/utils';

/**
 * shadcn/ui-style Button primitive with variant + size support.
 *
 * Migrated from `apps/web/src/components/ui/button.tsx` (task 60.1) so a
 * single canonical implementation is shared across every consumer.
 * Token references use `hsl(var(--…))` so the primitive remains compatible
 * with apps/web's Tailwind v3 setup; the reference port at
 * `School Platform Design/` keeps its Tailwind v4 token shorthands.
 *
 * Touch-target floor (Requirement 37 AC 3 — task 56.3): every interactive
 * variant carries `min-h-[48px]`, `min-w-[48px]`, and `gap-3` (12 px) so
 * that every <Button> — regardless of variant or size — meets the WCAG
 * 2.5.5 / Material 48 × 48 px activation-area minimum and has 12 px of
 * spacing between an icon and its label.
 *
 * The size variants are intentionally aligned with that 48 px floor:
 *   • `default` and `lg` use `h-12` so the markup matches the rendered
 *     box (no implicit reliance on `min-h-[48px]` overriding `h-10/h-11`).
 *   • `sm` keeps a tighter visual (smaller `px`/`rounded` chrome) but
 *     still floors at 48 × 48 px — the touch-target rule is an a11y
 *     requirement, not a visual one, so dense layouts stay tappable. We
 *     prefer floor-via-`min-*` over an invisible padding hit area because
 *     the latter creates surprising overlapping click zones in dense
 *     toolbars and breaks `aria-disabled` styling.
 *   • `icon` uses `h-12 w-12 p-0` so an icon-only square button is
 *     exactly 48 × 48 px with no padding cropping the glyph.
 *
 * This intentionally renders larger than baseline shadcn — see Design § K.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-3 min-h-[48px] min-w-[48px] whitespace-nowrap rounded-md text-sm font-medium ring-offset-[hsl(var(--background))] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))]/90',
        destructive:
          'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:bg-[hsl(var(--destructive))]/90',
        outline:
          'border border-[hsl(var(--input))] bg-[hsl(var(--background))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--secondary-foreground))]',
        secondary:
          'bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] hover:bg-[hsl(var(--secondary))]/80',
        ghost: 'hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--secondary-foreground))]',
        link: 'text-[hsl(var(--primary))] underline-offset-4 hover:underline',
      },
      size: {
        // h-12 = 48px — matches the touch-target floor exactly.
        default: 'h-12 px-4 py-2',
        // `sm` keeps tighter horizontal chrome (px-3, no extra rounding)
        // but still floors at 48 × 48 px via the base layer's `min-*`.
        // Touch target is an a11y requirement; visual density is achieved
        // through padding/width, not by shrinking the activation area.
        sm: 'h-12 rounded-md px-3',
        lg: 'h-12 rounded-md px-8',
        // Icon-only square — 48 × 48 px with no padding cropping the glyph.
        icon: 'h-12 w-12 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';
