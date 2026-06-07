import { cn } from '@/lib/utils';

interface LegalProseProps {
  readonly children: React.ReactNode;
  readonly className?: string;
}

/**
 * Long-form prose container for legal pages.
 *
 * Tailwind's typography plugin is intentionally not introduced here — we
 * style the small set of needed elements directly to keep the public
 * website dependency surface minimal.
 */
export function LegalProse({ children, className }: LegalProseProps) {
  return (
    <div
      className={cn(
        'mx-auto max-w-3xl text-foreground',
        '[&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight',
        '[&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold',
        '[&_p]:mt-4 [&_p]:leading-relaxed [&_p]:text-muted-foreground',
        '[&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_ul]:text-muted-foreground',
        '[&_a]:font-medium [&_a]:text-primary hover:[&_a]:underline',
        className,
      )}
    >
      {children}
    </div>
  );
}
