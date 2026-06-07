import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * shadcn/ui-style Button primitive.
 *
 * Touch-target floor (Requirement 37 AC 3 — task 56.3): every interactive
 * variant carries `min-h-[48px]`, `min-w-[48px]`, and `gap-3` (12 px) so
 * that every <Button> hits the WCAG 2.5.5 / Material 48 × 48 px activation
 * area regardless of variant or size. Size variants use `h-12` / `w-12`
 * to match the floor; `sm` keeps tighter horizontal chrome but still
 * floors at 48 × 48 px (touch target is an a11y rule, not visual).
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
        ghost:
          'hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--secondary-foreground))]',
        link: 'text-[hsl(var(--primary))] underline-offset-4 hover:underline',
        accent:
          'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] hover:bg-[hsl(var(--accent))]/90',
      },
      size: {
        default: 'h-12 px-4 py-2',
        sm: 'h-12 rounded-md px-3',
        lg: 'h-12 rounded-md px-8',
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
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
