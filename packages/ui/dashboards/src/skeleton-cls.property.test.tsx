/**
 * @vitest-environment jsdom
 *
 * Property-Based Test: F-8 Loading-State Skeleton and CLS
 *
 * **Validates: Requirements 39.2, 24.x**
 *
 * Property F-8: For any async data view `v`, `v` SHALL render a Skeleton
 * matching the loaded layout's grid for at least 300ms or until data arrives
 * (whichever is shorter), and the hydrated content SHALL produce a Cumulative
 * Layout Shift score ≤ 0.1 for that route.
 *
 * This property test uses fast-check to generate arbitrary widget
 * configurations and verify that:
 * 1. Every skeleton element has explicit dimension classes (h-* and w-*)
 *    so the browser reserves space before content loads
 * 2. The loading state container uses the same outer wrapper element as
 *    the loaded state (same tag, same structural role)
 * 3. The skeleton state sets aria-busy="true" to signal loading
 * 4. Transitioning from loading→loaded does not change the outer
 *    container's structural class footprint (overflow, card wrapper)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import fc from 'fast-check';

import { KpiCard } from './KpiCard';
import { DashboardSection } from './DashboardSection';
import { DataTableCard } from './DataTableCard';
import { MapDrillDown } from './MapDrillDown';
import { WelcomeBanner } from './WelcomeBanner';
import { TaskChecklist } from './TaskChecklist';
import { ActionItemList } from './ActionItemList';
import { TimelineSchedule } from './TimelineSchedule';
import { RadarComparison } from './RadarComparison';
import { KpiCardWithTrend } from './KpiCardWithTrend';

afterEach(() => {
  cleanup();
});

/**
 * Helper: extract all Skeleton elements from a container and verify each
 * has explicit dimension classes (h-* for height, w-* for width).
 */
function assertSkeletonsHaveExplicitDimensions(container: HTMLElement): void {
  const skeletons = container.querySelectorAll('[class*="animate-pulse"]');
  expect(skeletons.length).toBeGreaterThan(0);

  skeletons.forEach((skeleton, index) => {
    const classes = skeleton.getAttribute('class') ?? '';
    const hasHeight = /\bh-\d+|\bh-\[/.test(classes);
    const hasWidth = /\bw-\d+|\bw-\[|\bw-full/.test(classes);
    expect(
      hasHeight,
      `Skeleton #${index} missing explicit height class. Classes: "${classes}"`,
    ).toBe(true);
    expect(hasWidth, `Skeleton #${index} missing explicit width class. Classes: "${classes}"`).toBe(
      true,
    );
  });
}

/**
 * Helper: verify the outer container element is structurally consistent
 * between loading and loaded states (same tag name, same data-testid).
 */
function assertContainerStructuralConsistency(
  loadingContainer: HTMLElement,
  loadedContainer: HTMLElement,
): void {
  // Same outer element tag
  expect(loadingContainer.tagName).toBe(loadedContainer.tagName);

  // Both should have the same data-testid
  expect(loadingContainer.getAttribute('data-testid')).toBe(
    loadedContainer.getAttribute('data-testid'),
  );
}

describe('Property F-8: Loading-State Skeleton and CLS', () => {
  it('KpiCard: skeleton has explicit dimensions matching loaded layout for any label/value', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.boolean(),
        (label, value, hasIcon) => {
          cleanup();

          const testId = 'kpi-cls-test';
          const icon = hasIcon ? <span>📊</span> : undefined;

          // Render in loading state
          const { container: loadingWrapper } = render(
            <KpiCard label={label} value={value} icon={icon} loading data-testid={testId} />,
          );

          const loadingCard = loadingWrapper.querySelector(
            `[data-testid="${testId}"]`,
          ) as HTMLElement;

          // PROPERTY 1: Skeleton elements have explicit dimensions
          assertSkeletonsHaveExplicitDimensions(loadingCard);

          // PROPERTY 2: Loading state signals aria-busy
          expect(loadingCard.getAttribute('aria-busy')).toBe('true');

          // PROPERTY 3: Loading state uses data-state="loading"
          expect(loadingCard.getAttribute('data-state')).toBe('loading');

          cleanup();

          // Render in loaded state
          const { container: loadedWrapper } = render(
            <KpiCard label={label} value={value} icon={icon} data-testid={testId} />,
          );

          const loadedCard = loadedWrapper.querySelector(
            `[data-testid="${testId}"]`,
          ) as HTMLElement;

          // PROPERTY 4: Container structural consistency
          assertContainerStructuralConsistency(loadingCard, loadedCard);

          // PROPERTY 5: Loaded state has data-state="ready" (no longer busy)
          expect(loadedCard.getAttribute('data-state')).toBe('ready');
          expect(loadedCard.getAttribute('aria-busy')).toBeNull();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('DashboardSection: skeleton placeholders have explicit dimensions for any title/placeholder count', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 80 }),
        fc.integer({ min: 1, max: 10 }),
        (title, placeholderCount) => {
          cleanup();

          const testId = 'section-cls-test';

          // Render in loading state
          const { container: loadingWrapper } = render(
            <DashboardSection
              title={title}
              loading
              loadingPlaceholders={placeholderCount}
              data-testid={testId}
            >
              <div>Content</div>
            </DashboardSection>,
          );

          const loadingSection = loadingWrapper.querySelector(
            `[data-testid="${testId}"]`,
          ) as HTMLElement;

          // PROPERTY 1: Skeleton elements have explicit dimensions
          assertSkeletonsHaveExplicitDimensions(loadingSection);

          // PROPERTY 2: Number of skeleton placeholders matches requested count
          const skeletonBody = loadingSection.querySelector(
            '[data-testid="dashboard-section-skeleton"]',
          ) as HTMLElement;
          expect(skeletonBody).not.toBeNull();
          const skeletons = skeletonBody.querySelectorAll('[class*="animate-pulse"]');
          expect(skeletons.length).toBe(placeholderCount);

          // PROPERTY 3: Loading state signals aria-busy on the skeleton container
          expect(skeletonBody.getAttribute('aria-busy')).toBe('true');

          // PROPERTY 4: Section uses data-state="loading"
          expect(loadingSection.getAttribute('data-state')).toBe('loading');

          cleanup();

          // Render in loaded state
          const { container: loadedWrapper } = render(
            <DashboardSection title={title} data-testid={testId}>
              <div>Content</div>
            </DashboardSection>,
          );

          const loadedSection = loadedWrapper.querySelector(
            `[data-testid="${testId}"]`,
          ) as HTMLElement;

          // PROPERTY 5: Container structural consistency
          assertContainerStructuralConsistency(loadingSection, loadedSection);

          // PROPERTY 6: Loaded state has data-state="ready"
          expect(loadedSection.getAttribute('data-state')).toBe('ready');
        },
      ),
      { numRuns: 50 },
    );
  });

  it('DataTableCard: skeleton rows match column count for any column configuration', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 60 }),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 20 }),
        (title, columnCount, loadingRowCount) => {
          cleanup();

          const testId = 'table-cls-test';

          // Generate column definitions
          const columns = Array.from({ length: columnCount }, (_, i) => ({
            id: `col-${i}`,
            header: `Column ${i}`,
            cell: (row: { id: number }) => `${row.id}-${i}`,
          }));

          // Render in loading state
          const { container: loadingWrapper } = render(
            <DataTableCard
              title={title}
              columns={columns}
              rows={[]}
              rowKey={(_, i) => i}
              loading
              loadingRowCount={loadingRowCount}
              data-testid={testId}
            />,
          );

          const loadingCard = loadingWrapper.querySelector(
            `[data-testid="${testId}"]`,
          ) as HTMLElement;

          // PROPERTY 1: Skeleton elements have explicit dimensions
          assertSkeletonsHaveExplicitDimensions(loadingCard);

          // PROPERTY 2: Number of skeleton rows matches loadingRowCount
          const skeletonRows = loadingCard.querySelectorAll(
            '[data-testid="data-table-card-skeleton-row"]',
          );
          expect(skeletonRows.length).toBe(Math.max(1, loadingRowCount));

          // PROPERTY 3: Each skeleton row has exactly columnCount skeleton cells
          skeletonRows.forEach((row) => {
            const cells = row.querySelectorAll('[class*="animate-pulse"]');
            expect(cells.length).toBe(columnCount);
          });

          // PROPERTY 4: Loading state signals aria-busy
          expect(loadingCard.getAttribute('aria-busy')).toBe('true');

          // PROPERTY 5: data-state is "loading"
          expect(loadingCard.getAttribute('data-state')).toBe('loading');

          cleanup();

          // Render in loaded state with matching rows
          const rows = Array.from({ length: 3 }, (_, i) => ({ id: i }));
          const { container: loadedWrapper } = render(
            <DataTableCard
              title={title}
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              data-testid={testId}
            />,
          );

          const loadedCard = loadedWrapper.querySelector(
            `[data-testid="${testId}"]`,
          ) as HTMLElement;

          // PROPERTY 6: Container structural consistency
          assertContainerStructuralConsistency(loadingCard, loadedCard);

          // PROPERTY 7: Loaded state has data-state="ready"
          expect(loadedCard.getAttribute('data-state')).toBe('ready');
        },
      ),
      { numRuns: 50 },
    );
  });

  it('MapDrillDown: skeleton has explicit dimensions for any title', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 80 }), (title) => {
        cleanup();

        const testId = 'map-cls-test';

        // Render in loading state
        const { container: loadingWrapper } = render(
          <MapDrillDown title={title} regions={[]} loading data-testid={testId} />,
        );

        const loadingCard = loadingWrapper.querySelector(
          `[data-testid="${testId}"]`,
        ) as HTMLElement;

        // PROPERTY 1: Skeleton elements have explicit dimensions
        assertSkeletonsHaveExplicitDimensions(loadingCard);

        // PROPERTY 2: Loading state signals aria-busy
        expect(loadingCard.getAttribute('aria-busy')).toBe('true');

        // PROPERTY 3: data-state is "loading"
        expect(loadingCard.getAttribute('data-state')).toBe('loading');

        cleanup();

        // Render in loaded state
        const regions = [{ id: 'r1', name: 'Region 1', value: 100 }];
        const { container: loadedWrapper } = render(
          <MapDrillDown title={title} regions={regions} data-testid={testId} />,
        );

        const loadedCard = loadedWrapper.querySelector(`[data-testid="${testId}"]`) as HTMLElement;

        // PROPERTY 4: Container structural consistency
        assertContainerStructuralConsistency(loadingCard, loadedCard);

        // PROPERTY 5: Loaded state has data-state="ready"
        expect(loadedCard.getAttribute('data-state')).toBe('ready');
      }),
      { numRuns: 50 },
    );
  });

  it('WelcomeBanner: skeleton has explicit dimensions for any user/brand name', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (userName, brandName) => {
          cleanup();

          const testId = 'banner-cls-test';
          const fixedDate = new Date(2024, 5, 15, 10, 0, 0);

          // Render in loading state
          const { container: loadingWrapper } = render(
            <WelcomeBanner
              userName={userName}
              brandName={brandName}
              now={fixedDate}
              loading
              data-testid={testId}
            />,
          );

          const loadingCard = loadingWrapper.querySelector(
            `[data-testid="${testId}"]`,
          ) as HTMLElement;

          // PROPERTY 1: Skeleton elements have explicit dimensions
          assertSkeletonsHaveExplicitDimensions(loadingCard);

          // PROPERTY 2: Loading state signals aria-busy
          expect(loadingCard.getAttribute('aria-busy')).toBe('true');

          // PROPERTY 3: data-state is "loading"
          expect(loadingCard.getAttribute('data-state')).toBe('loading');

          cleanup();

          // Render in loaded state
          const { container: loadedWrapper } = render(
            <WelcomeBanner
              userName={userName}
              brandName={brandName}
              now={fixedDate}
              data-testid={testId}
            />,
          );

          const loadedCard = loadedWrapper.querySelector(
            `[data-testid="${testId}"]`,
          ) as HTMLElement;

          // PROPERTY 4: Container structural consistency
          assertContainerStructuralConsistency(loadingCard, loadedCard);

          // PROPERTY 5: Loaded state has data-state="ready"
          expect(loadedCard.getAttribute('data-state')).toBe('ready');
        },
      ),
      { numRuns: 50 },
    );
  });

  it('all widgets: skeleton outer container class includes "overflow-hidden" to prevent CLS bleed', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('KpiCard', 'DataTableCard', 'MapDrillDown', 'WelcomeBanner'),
        fc.string({ minLength: 1, maxLength: 40 }),
        (widgetType, label) => {
          cleanup();

          const testId = 'overflow-cls-test';
          let element: React.ReactElement;

          switch (widgetType) {
            case 'KpiCard':
              element = <KpiCard label={label} value="0" loading data-testid={testId} />;
              break;
            case 'DataTableCard':
              element = (
                <DataTableCard
                  title={label}
                  columns={[{ id: 'c1', header: 'H', cell: () => 'x' }]}
                  rows={[]}
                  rowKey={(_, i) => i}
                  loading
                  data-testid={testId}
                />
              );
              break;
            case 'MapDrillDown':
              element = <MapDrillDown title={label} regions={[]} loading data-testid={testId} />;
              break;
            case 'WelcomeBanner':
              element = (
                <WelcomeBanner
                  userName={label}
                  loading
                  now={new Date(2024, 0, 1, 12)}
                  data-testid={testId}
                />
              );
              break;
            default:
              element = <KpiCard label={label} value="0" loading data-testid={testId} />;
          }

          const { container } = render(element);
          const card = container.querySelector(`[data-testid="${testId}"]`) as HTMLElement;

          // PROPERTY: The outer card container includes overflow-hidden
          // to prevent skeleton animation from bleeding outside bounds
          // and causing layout shift
          const classes = card.getAttribute('class') ?? '';
          expect(
            classes.includes('overflow-hidden'),
            `Widget "${widgetType}" skeleton container missing overflow-hidden. Classes: "${classes}"`,
          ).toBe(true);
        },
      ),
      { numRuns: 40 },
    );
  });
});
