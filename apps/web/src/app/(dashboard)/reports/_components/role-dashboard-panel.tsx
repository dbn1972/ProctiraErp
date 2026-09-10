'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';
import type { RoleDashboard } from '@/lib/api/reports';

export function RoleDashboardPanel({ dashboard }: { dashboard: RoleDashboard }) {
  const hydrated = useHydrated();
  return (
    <div
      data-testid="role-dashboard"
      data-role={dashboard.role}
      data-hydrated={hydrated ? 'true' : 'false'}
      className="space-y-4"
    >
      <h2 className="text-lg font-semibold" data-testid="dashboard-role-title">
        {dashboard.title}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {dashboard.cards.map((card) => (
          <Card key={card.id} data-testid={`dashboard-card-${card.id}`} data-card-id={card.id}>
            <CardHeader className="pb-2">
              <CardDescription>{card.title}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{card.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{card.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
