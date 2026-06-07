/**
 * TimePeriodSelector — year/quarter/month picker for data warehouse queries.
 *
 * Allows users to select one or more time periods from the available
 * periods in the data warehouse.
 *
 * Task 60A.5 / Requirements 15.1
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Skeleton,
} from '@proctira/ui/components';
import { fetchTimePeriods, type TimePeriod } from '../api/data-warehouse-browser';

interface TimePeriodSelectorProps {
  /** Currently selected time period IDs */
  selectedIds: string[];
  /** Callback when selection changes */
  onSelectionChange: (ids: string[]) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Accessible label */
  ariaLabel?: string;
}

export function TimePeriodSelector({
  selectedIds,
  onSelectionChange,
  placeholder = 'Select time periods…',
  ariaLabel = 'Select time periods',
}: TimePeriodSelectorProps) {
  const [periods, setPeriods] = useState<TimePeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      try {
        const data = await fetchTimePeriods(controller.signal);
        setPeriods(data);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Failed to load time periods:', err);
        }
      } finally {
        setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  // Group periods by year
  const groupedByYear = useMemo(() => {
    const groups = new Map<number, TimePeriod[]>();
    for (const period of periods) {
      const existing = groups.get(period.year) ?? [];
      existing.push(period);
      groups.set(period.year, existing);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => b - a);
  }, [periods]);

  const togglePeriod = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((sid) => sid !== id)
      : [...selectedIds, id];
    onSelectionChange(next);
  };

  const toggleYear = (year: number) => {
    const yearPeriods = periods.filter((p) => p.year === year);
    const yearIds = yearPeriods.map((p) => p.id);
    const allSelected = yearIds.every((id) => selectedIds.includes(id));

    if (allSelected) {
      onSelectionChange(selectedIds.filter((id) => !yearIds.includes(id)));
    } else {
      const newIds = new Set([...selectedIds, ...yearIds]);
      onSelectionChange(Array.from(newIds));
    }
  };

  const selectedLabels = useMemo(
    () => periods.filter((p) => selectedIds.includes(p.id)).map((p) => p.label),
    [periods, selectedIds],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-start text-left font-normal"
          aria-label={ariaLabel}
        >
          {selectedLabels.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {selectedLabels.length <= 3 ? (
                selectedLabels.map((label) => (
                  <Badge key={label} variant="secondary" className="text-xs">
                    {label}
                  </Badge>
                ))
              ) : (
                <Badge variant="secondary" className="text-xs">
                  {selectedLabels.length} periods selected
                </Badge>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <ScrollArea className="h-[300px] p-3">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : groupedByYear.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No time periods available.
            </p>
          ) : (
            <div className="space-y-3">
              {groupedByYear.map(([year, yearPeriods]) => {
                const yearIds = yearPeriods.map((p) => p.id);
                const allSelected = yearIds.every((id) => selectedIds.includes(id));
                const someSelected = yearIds.some((id) => selectedIds.includes(id));

                return (
                  <div key={year}>
                    <label className="flex items-center gap-2 font-semibold text-sm cursor-pointer mb-1">
                      <Checkbox
                        checked={allSelected}
                        // indeterminate state handled via data attribute
                        data-indeterminate={someSelected && !allSelected}
                        onCheckedChange={() => toggleYear(year)}
                      />
                      {year}
                    </label>
                    <div className="ml-6 space-y-1">
                      {yearPeriods.map((period) => (
                        <label
                          key={period.id}
                          className="flex items-center gap-2 text-sm cursor-pointer"
                        >
                          <Checkbox
                            checked={selectedIds.includes(period.id)}
                            onCheckedChange={() => togglePeriod(period.id)}
                          />
                          {period.label}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
        {selectedIds.length > 0 && (
          <div className="border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => onSelectionChange([])}
            >
              Clear selection
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
