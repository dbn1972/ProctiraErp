import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';

import { MotionGate } from './MotionGate';

/**
 * PRC-L597 — widget-level axe-core WCAG 2.1 AA gate for `<MotionGate>`.
 * `<MotionGate>` is a transparent context provider, so the gate checks that
 * it adds no accessibility violations to the sub-tree it wraps in any of its
 * motion-preference modes.
 *
 * Regression gate (not failing-first): asserts the current contract and
 * guards it going forward.
 */
describe('<MotionGate /> — axe-core WCAG 2.1 AA gate (PRC-L597)', () => {
  it('default gate adds no violations to its sub-tree', async () => {
    const { container } = render(
      <MotionGate>
        <button type="button">Play animation</button>
      </MotionGate>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('forceReduce mode adds no violations to its sub-tree', async () => {
    const { container } = render(
      <MotionGate forceReduce>
        <main aria-label="Dashboard">
          <h1>Overview</h1>
          <p>Static content shown when motion is reduced.</p>
        </main>
      </MotionGate>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('forceMotion mode adds no violations to its sub-tree', async () => {
    const { container } = render(
      <MotionGate forceMotion>
        <button type="button">Replay</button>
      </MotionGate>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
