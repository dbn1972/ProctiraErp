import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MotionGate, useMotionPreference } from './MotionGate';

function Probe() {
  const { disableMotion } = useMotionPreference();
  return <span data-testid="probe">{disableMotion ? 'off' : 'on'}</span>;
}

const original = window.matchMedia;
const mockReduce = (matches: boolean) =>
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });

describe('MotionGate precedence and nesting (PRC-L524)', () => {
  beforeEach(() => mockReduce(false));
  afterEach(() =>
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: original,
    }),
  );

  it('nested gate under forceReduce stays disabled', () => {
    render(
      <MotionGate forceReduce>
        <MotionGate>
          <Probe />
        </MotionGate>
      </MotionGate>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('off');
  });

  it('nested forceMotion cannot override an ancestor forceReduce', () => {
    render(
      <MotionGate forceReduce>
        <MotionGate forceMotion>
          <Probe />
        </MotionGate>
      </MotionGate>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('off');
  });

  it('both props on one gate -> disabled', () => {
    render(
      <MotionGate forceReduce forceMotion>
        <Probe />
      </MotionGate>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('off');
  });

  it('forceMotion still allows essential animation under the OS reduce preference', () => {
    mockReduce(true);
    render(
      <MotionGate>
        <MotionGate forceMotion>
          <Probe />
        </MotionGate>
      </MotionGate>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('on');
  });
});
