import { Card, CardContent } from '@proctira/ui/components';

import { cn } from '@/lib/utils';

export function KpiCard({
  icon,
  iconClass,
  label,
  value,
  foot,
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string;
  foot?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              iconClass,
            )}
          >
            {icon}
          </span>
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
        </div>
        <div className="mt-3 text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
          {value}
        </div>
        {foot ? <p className="mt-1 text-xs text-muted-foreground">{foot}</p> : null}
      </CardContent>
    </Card>
  );
}
