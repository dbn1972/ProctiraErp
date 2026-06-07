/**
 * Infrastructure tab — Server Component.
 *
 * Renders the parent-child Land → Building → Floor → Room hierarchy along
 * with capacity and condition information. Powered by the institution
 * service's `/infrastructure/hierarchy` endpoint (Requirement 5.6).
 */
import { Building, Home, Layers, Map } from 'lucide-react';

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import {
  ApiClientError,
  getInfrastructureHierarchy,
} from '@/lib/institutions/api';
import type { InfrastructureHierarchy } from '@/lib/institutions/types';

interface InfrastructurePageProps {
  params: { id: string };
}

export default async function InstitutionInfrastructurePage({
  params,
}: InfrastructurePageProps) {
  const result = await loadHierarchy(params.id);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Map className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-base">Infrastructure</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {result.error ? (
          <p className="text-sm text-muted-foreground">{result.error}</p>
        ) : result.hierarchy.lands.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No infrastructure has been recorded for this institution yet.
          </p>
        ) : (
          result.hierarchy.lands.map((land) => (
            <div
              key={land.id}
              className="rounded-md border bg-muted/20 p-4"
              data-testid="infrastructure-land"
            >
              <InfrastructureRow
                icon={<Map className="h-4 w-4" aria-hidden="true" />}
                title={land.name}
                capacity={land.capacity}
                condition={land.condition}
                description={land.description}
              />

              {land.buildings.length > 0 && (
                <div className="mt-3 space-y-3 border-l-2 border-border pl-4">
                  {land.buildings.map((building) => (
                    <div key={building.id} className="space-y-2">
                      <InfrastructureRow
                        icon={<Building className="h-4 w-4" aria-hidden="true" />}
                        title={building.name}
                        capacity={building.capacity}
                        condition={building.condition}
                        description={building.description}
                      />
                      {building.floors.length > 0 && (
                        <div className="ml-2 space-y-2 border-l border-border pl-4">
                          {building.floors.map((floor) => (
                            <div key={floor.id} className="space-y-1">
                              <InfrastructureRow
                                icon={
                                  <Layers
                                    className="h-4 w-4"
                                    aria-hidden="true"
                                  />
                                }
                                title={floor.name}
                                capacity={floor.capacity}
                                condition={floor.condition}
                                description={floor.description}
                              />
                              {floor.rooms.length > 0 && (
                                <ul className="ml-2 space-y-1 border-l border-border pl-4">
                                  {floor.rooms.map((room) => (
                                    <li key={room.id}>
                                      <InfrastructureRow
                                        icon={
                                          <Home
                                            className="h-4 w-4"
                                            aria-hidden="true"
                                          />
                                        }
                                        title={room.name}
                                        capacity={room.capacity}
                                        condition={room.condition}
                                        description={room.description}
                                      />
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function InfrastructureRow({
  icon,
  title,
  capacity,
  condition,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  capacity: number;
  condition: string;
  description: string | null;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-2 font-medium text-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {title}
        {description && (
          <span className="text-xs font-normal text-muted-foreground">
            — {description}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="outline">Capacity {capacity.toLocaleString()}</Badge>
        <Badge variant="secondary">{condition}</Badge>
      </div>
    </div>
  );
}

async function loadHierarchy(
  institutionId: string
): Promise<
  | { hierarchy: InfrastructureHierarchy; error: null }
  | { hierarchy: { lands: [] }; error: string }
> {
  try {
    const hierarchy = await getInfrastructureHierarchy(institutionId);
    return { hierarchy, error: null };
  } catch (error) {
    return {
      hierarchy: { lands: [] },
      error:
        error instanceof ApiClientError
          ? error.message
          : 'Infrastructure data is currently unavailable.',
    };
  }
}
