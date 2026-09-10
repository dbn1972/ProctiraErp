/**
 * IUSCombinationBrowser — browse Indicator-Unit-Subgroup combinations.
 *
 * Displays a table of all IUS combinations available in the data warehouse,
 * with filtering by indicator. Shows data availability counts per combination.
 *
 * Task 60A.5 / Requirements 15.1
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Badge,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ScrollArea,
} from '@proctira/ui/components';
import { fetchIUSCombinations, type IUSCombination } from '../api/data-warehouse-browser';

interface IUSCombinationBrowserProps {
  /** Pre-filter by indicator IDs */
  indicatorIds?: string[];
  /** Callback when a combination is selected */
  onSelect?: (combination: IUSCombination) => void;
}

export default function IUSCombinationBrowser({
  indicatorIds,
  onSelect,
}: IUSCombinationBrowserProps) {
  const [combinations, setCombinations] = useState<IUSCombination[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      try {
        const data = await fetchIUSCombinations({
          indicatorIds,
          signal: controller.signal,
        });
        setCombinations(data);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Failed to load IUS combinations:', err);
        }
      } finally {
        setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [indicatorIds]);

  const filteredCombinations = search
    ? combinations.filter(
        (c) =>
          c.indicatorName.toLowerCase().includes(search.toLowerCase()) ||
          c.unitName.toLowerCase().includes(search.toLowerCase()) ||
          c.subgroupName.toLowerCase().includes(search.toLowerCase()),
      )
    : combinations;

  const handleSelect = useCallback(
    (combination: IUSCombination) => {
      setSelectedId(combination.id);
      onSelect?.(combination);
    },
    [onSelect],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>IUS Combinations</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <Input
            placeholder="Search combinations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search IUS combinations"
          />
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : filteredCombinations.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No IUS combinations found.</p>
        ) : (
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Indicator</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Subgroup</TableHead>
                  <TableHead className="text-right">Data Points</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCombinations.map((combo) => (
                  <TableRow
                    key={combo.id}
                    className={`cursor-pointer ${
                      selectedId === combo.id ? 'bg-primary/10' : 'hover:bg-muted/50'
                    }`}
                    onClick={() => handleSelect(combo)}
                    role="button"
                    aria-selected={selectedId === combo.id}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelect(combo);
                      }
                    }}
                  >
                    <TableCell className="font-medium">{combo.indicatorName}</TableCell>
                    <TableCell>{combo.unitName}</TableCell>
                    <TableCell>{combo.subgroupName}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{combo.dataCount}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}

        <p className="text-xs text-muted-foreground mt-3">
          {filteredCombinations.length} combination{filteredCombinations.length !== 1 ? 's' : ''}{' '}
          found
        </p>
      </CardContent>
    </Card>
  );
}
