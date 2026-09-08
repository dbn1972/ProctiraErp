import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from './lib/utils';

/**
 * Alert primitive for inline status messages. Migrated from
 * `apps/web/src/components/ui/alert.tsx` during task 60.1.
 *
 * Variants: default (info), destructive (error), success, warning.
 */
const alertVariants = cva(
  'relative w-full rounded-md border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:start-4 [&>svg]:top-3.5 [&>svg]:size-4 [&>svg+div]:translate-y-[-2px] [&>svg~*]:ps-7',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-secondary-foreground border-border',
        destructive:
          'border-destructive/40 bg-destructive/10 text-destructive [&>svg]:text-destructive',
        success: 'border-emerald-300 bg-emerald-50 text-emerald-800 [&>svg]:text-emerald-600',
        warning: 'border-amber-300 bg-amber-50 text-amber-800 [&>svg]:text-amber-600',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5
      ref={ref}
      className={cn('mb-1 font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  ),
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-sm leading-relaxed [&_p]:leading-relaxed', className)}
    {...props}
  />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
