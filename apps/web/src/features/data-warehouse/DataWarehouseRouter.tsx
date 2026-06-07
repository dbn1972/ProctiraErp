/**
 * DataWarehouseRouter — sub-router for the data warehouse IUS browser feature.
 *
 * Mounted by the federated `RootRouter` at `/app/data-warehouse/*`. Each
 * sub-route lazy-loads its page component.
 *
 * Task 60A.5: Data warehouse / DevInfo IUS browser.
 * Requirements: 15.1, 15.3, 15.4, 15.5
 */

import { lazy, Suspense, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@proctira/ui/components';
import type { IndicatorSelection } from './pages/IndicatorBrowser';

const IndicatorBrowser = lazy(() => import('./pages/IndicatorBrowser'));
const IUSCombinationBrowser = lazy(() => import('./pages/IUSCombinationBrowser'));
const DataQueryBuilder = lazy(() => import('./pages/DataQueryBuilder'));

/**
 * Main data warehouse page with tabbed navigation between
 * Indicator Browser, IUS Combinations, and Data Query Builder.
 */
function DataWarehouseMain() {
  const [indicatorSelections, setIndicatorSelections] = useState<IndicatorSelection[]>([]);
  const [activeTab, setActiveTab] = useState('indicators');

  const selectedIndicatorIds = indicatorSelections.map((s) => s.indicatorId);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Data Warehouse</h1>
        <p className="text-muted-foreground mt-1">
          Browse indicators, explore IUS combinations, and query statistical data.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="indicators">Indicator Browser</TabsTrigger>
          <TabsTrigger value="ius">IUS Combinations</TabsTrigger>
          <TabsTrigger value="query">Data Query</TabsTrigger>
        </TabsList>

        <TabsContent value="indicators" className="mt-4">
          <Suspense
            fallback={
              <div role="status" aria-label="Loading" className="p-6 text-muted-foreground">
                Loading…
              </div>
            }
          >
            <IndicatorBrowser
              onSelectionChange={setIndicatorSelections}
              initialSelections={indicatorSelections}
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="ius" className="mt-4">
          <Suspense
            fallback={
              <div role="status" aria-label="Loading" className="p-6 text-muted-foreground">
                Loading…
              </div>
            }
          >
            <IUSCombinationBrowser indicatorIds={selectedIndicatorIds} />
          </Suspense>
        </TabsContent>

        <TabsContent value="query" className="mt-4">
          <Suspense
            fallback={
              <div role="status" aria-label="Loading" className="p-6 text-muted-foreground">
                Loading…
              </div>
            }
          >
            <DataQueryBuilder indicatorSelections={indicatorSelections} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function DataWarehouseRouter() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading" className="p-6 text-muted-foreground">
          Loading…
        </div>
      }
    >
      <Routes>
        <Route index element={<DataWarehouseMain />} />
        <Route path="*" element={<Navigate to="/app/data-warehouse" replace />} />
      </Routes>
    </Suspense>
  );
}
