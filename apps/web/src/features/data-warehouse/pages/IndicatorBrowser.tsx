/**
 * IndicatorBrowser — searchable/filterable list of DevInfo indicators.
 *
 * Displays a tree of Indicator → Unit → Subgroup with multi-select.
 * Users can search by name/keyword and filter by category.
 *
 * Task 60A.5 / Requirements 15.1, 15.5
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Checkbox,
  Skeleton,
  ScrollArea,
} from '@proctira/ui/components';
import {
  fetchIndicators,
  fetchIndicatorCategories,
  fetchUnits,
  fetchSubgroups,
  type Indicator,
  type Unit,
  type Subgroup,
} from '../api/data-warehouse-browser';

export interface IndicatorSelection {
  indicatorId: string;
  indicatorName: string;
  unitIds: string[];
  subgroupIds: string[];
}

interface IndicatorBrowserProps {
  /** Callback when selection changes */
  onSelectionChange?: (selections: IndicatorSelection[]) => void;
  /** Initial selections */
  initialSelections?: IndicatorSelection[];
}

interface ExpandedIndicator {
  indicator: Indicator;
  units: Unit[];
  subgroups: Subgroup[];
  loading: boolean;
}

export default function IndicatorBrowser({
  onSelectionChange,
  initialSelections = [],
}: IndicatorBrowserProps) {
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [expandedMap, setExpandedMap] = useState<Map<string, ExpandedIndicator>>(new Map());
  const [selections, setSelections] = useState<IndicatorSelection[]>(initialSelections);

  // Load indicators and categories on mount
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      try {
        const [indicatorData, categoryData] = await Promise.all([
          fetchIndicators({ signal: controller.signal }),
          fetchIndicatorCategories(controller.signal),
        ]);
        setIndicators(indicatorData);
        setCategories(categoryData);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Failed to load indicators:', err);
        }
      } finally {
        setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Re-fetch indicators when search/filter changes
  useEffect(() => {
    const controller = new AbortController();
    async function reload() {
      try {
        const data = await fetchIndicators({
          search: debouncedSearch || undefined,
          category: categoryFilter !== 'all' ? categoryFilter : undefined,
          signal: controller.signal,
        });
        setIndicators(data);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Failed to search indicators:', err);
        }
      }
    }
    if (debouncedSearch || categoryFilter !== 'all') {
      void reload();
    }
    return () => controller.abort();
  }, [debouncedSearch, categoryFilter]);

  // Expand an indicator to show its units and subgroups
  const toggleExpand = useCallback(async (indicator: Indicator) => {
    setExpandedMap((prev) => {
      const next = new Map(prev);
      if (next.has(indicator.id)) {
        next.delete(indicator.id);
      } else {
        next.set(indicator.id, { indicator, units: [], subgroups: [], loading: true });
      }
      return next;
    });

    // Load units and subgroups if expanding
    if (!expandedMap.has(indicator.id)) {
      try {
        const [units, subgroups] = await Promise.all([
          fetchUnits(indicator.id),
          fetchSubgroups(indicator.id),
        ]);
        setExpandedMap((prev) => {
          const next = new Map(prev);
          const entry = next.get(indicator.id);
          if (entry) {
            next.set(indicator.id, { ...entry, units, subgroups, loading: false });
          }
          return next;
        });
      } catch (err) {
        console.error('Failed to load indicator details:', err);
        setExpandedMap((prev) => {
          const next = new Map(prev);
          const entry = next.get(indicator.id);
          if (entry) {
            next.set(indicator.id, { ...entry, loading: false });
          }
          return next;
        });
      }
    }
  }, [expandedMap]);

  // Toggle indicator selection
  const toggleIndicatorSelection = useCallback((indicator: Indicator) => {
    setSelections((prev) => {
      const exists = prev.find((s) => s.indicatorId === indicator.id);
      let next: IndicatorSelection[];
      if (exists) {
        next = prev.filter((s) => s.indicatorId !== indicator.id);
      } else {
        next = [...prev, {
          indicatorId: indicator.id,
          indicatorName: indicator.name,
          unitIds: [],
          subgroupIds: [],
        }];
      }
      onSelectionChange?.(next);
      return next;
    });
  }, [onSelectionChange]);

  // Toggle unit selection within an indicator
  const toggleUnitSelection = useCallback((indicatorId: string, unitId: string) => {
    setSelections((prev) => {
      const next = prev.map((s) => {
        if (s.indicatorId !== indicatorId) return s;
        const unitIds = s.unitIds.includes(unitId)
          ? s.unitIds.filter((id) => id !== unitId)
          : [...s.unitIds, unitId];
        return { ...s, unitIds };
      });
      onSelectionChange?.(next);
      return next;
    });
  }, [onSelectionChange]);

  // Toggle subgroup selection within an indicator
  const toggleSubgroupSelection = useCallback((indicatorId: string, subgroupId: string) => {
    setSelections((prev) => {
      const next = prev.map((s) => {
        if (s.indicatorId !== indicatorId) return s;
        const subgroupIds = s.subgroupIds.includes(subgroupId)
          ? s.subgroupIds.filter((id) => id !== subgroupId)
          : [...s.subgroupIds, subgroupId];
        return { ...s, subgroupIds };
      });
      onSelectionChange?.(next);
      return next;
    });
  }, [onSelectionChange]);

  const selectedIndicatorIds = useMemo(
    () => new Set(selections.map((s) => s.indicatorId)),
    [selections],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Indicator Browser</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Search and filter controls */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <Input
              placeholder="Search indicators by name or keyword…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1"
              aria-label="Search indicators"
            />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-[200px]" aria-label="Filter by category">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Selection summary */}
          {selections.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {selections.map((sel) => (
                <Badge key={sel.indicatorId} variant="secondary">
                  {sel.indicatorName}
                  <button
                    className="ml-1 text-xs hover:text-destructive"
                    onClick={() => toggleIndicatorSelection({ id: sel.indicatorId, name: sel.indicatorName } as Indicator)}
                    aria-label={`Remove ${sel.indicatorName}`}
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {/* Indicator list */}
          <ScrollArea className="h-[400px]">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : indicators.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No indicators found. Try adjusting your search or filter.
              </p>
            ) : (
              <div className="space-y-1" role="tree" aria-label="Indicator tree">
                {indicators.map((indicator) => {
                  const isSelected = selectedIndicatorIds.has(indicator.id);
                  const expanded = expandedMap.get(indicator.id);
                  const selection = selections.find((s) => s.indicatorId === indicator.id);

                  return (
                    <div key={indicator.id} role="treeitem" aria-expanded={!!expanded}>
                      <div className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleIndicatorSelection(indicator)}
                          aria-label={`Select ${indicator.name}`}
                        />
                        <button
                          className="flex-1 text-left flex items-center gap-2"
                          onClick={() => toggleExpand(indicator)}
                          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${indicator.name}`}
                        >
                          <span className="text-xs text-muted-foreground">
                            {expanded ? '▼' : '▶'}
                          </span>
                          <span className="font-medium text-sm">{indicator.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {indicator.category}
                          </Badge>
                        </button>
                      </div>

                      {/* Expanded: show units and subgroups */}
                      {expanded && (
                        <div className="ml-8 border-l pl-4 py-2 space-y-3">
                          {expanded.loading ? (
                            <Skeleton className="h-8 w-48" />
                          ) : (
                            <>
                              {/* Units */}
                              {expanded.units.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground mb-1">
                                    Units
                                  </p>
                                  <div className="space-y-1">
                                    {expanded.units.map((unit) => (
                                      <label
                                        key={unit.id}
                                        className="flex items-center gap-2 text-sm cursor-pointer"
                                      >
                                        <Checkbox
                                          checked={selection?.unitIds.includes(unit.id) ?? false}
                                          onCheckedChange={() =>
                                            toggleUnitSelection(indicator.id, unit.id)
                                          }
                                          disabled={!isSelected}
                                        />
                                        {unit.name}
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Subgroups */}
                              {expanded.subgroups.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground mb-1">
                                    Subgroups
                                  </p>
                                  <div className="space-y-1">
                                    {expanded.subgroups.map((sg) => (
                                      <label
                                        key={sg.id}
                                        className="flex items-center gap-2 text-sm cursor-pointer"
                                      >
                                        <Checkbox
                                          checked={selection?.subgroupIds.includes(sg.id) ?? false}
                                          onCheckedChange={() =>
                                            toggleSubgroupSelection(indicator.id, sg.id)
                                          }
                                          disabled={!isSelected}
                                        />
                                        <span>{sg.name}</span>
                                        <span className="text-xs text-muted-foreground">
                                          ({sg.dimension})
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {expanded.units.length === 0 && expanded.subgroups.length === 0 && (
                                <p className="text-xs text-muted-foreground">
                                  No units or subgroups defined for this indicator.
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
