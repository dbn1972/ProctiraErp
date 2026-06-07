/**
 * @vitest-environment jsdom
 *
 * Tests for FeatureFlagsProvider (Task 53.5 / Requirements 41.1, 29.5)
 *
 * Asserts that:
 *   - The default `legacy_mobile_routes` flag is `false` so new tenants get
 *     the responsive shell automatically.
 *   - `useFeatureFlags()` returns those defaults outside a provider so
 *     unrelated render trees never crash.
 *   - Initial flags supplied to the provider override the defaults.
 *   - Partial initial flag maps merge with the defaults so missing keys keep
 *     their documented value.
 *   - The exposed flag map is frozen so consumers cannot mutate shared state.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import {
  FeatureFlagsProvider,
  useFeatureFlags,
  DEFAULT_FEATURE_FLAGS,
  LEGACY_MOBILE_ROUTES_FEATURE_KEY,
} from './FeatureFlagsProvider';

function FlagProbe({ flag }: { flag: typeof LEGACY_MOBILE_ROUTES_FEATURE_KEY }) {
  const { flags, isEnabled } = useFeatureFlags();
  return (
    <div>
      <span data-testid="flags-keys">{Object.keys(flags).join(',')}</span>
      <span data-testid={`flag-${flag}`}>{String(flags[flag])}</span>
      <span data-testid={`is-enabled-${flag}`}>{String(isEnabled(flag))}</span>
    </div>
  );
}

describe('DEFAULT_FEATURE_FLAGS', () => {
  it('defaults legacy_mobile_routes to false', () => {
    expect(DEFAULT_FEATURE_FLAGS[LEGACY_MOBILE_ROUTES_FEATURE_KEY]).toBe(false);
  });

  it('is frozen at module load', () => {
    expect(Object.isFrozen(DEFAULT_FEATURE_FLAGS)).toBe(true);
  });

  it('exposes a stable feature key constant', () => {
    expect(LEGACY_MOBILE_ROUTES_FEATURE_KEY).toBe('legacy_mobile_routes');
  });
});

describe('useFeatureFlags — outside a provider', () => {
  it('returns the documented defaults so unrelated trees never crash', () => {
    render(<FlagProbe flag={LEGACY_MOBILE_ROUTES_FEATURE_KEY} />);
    expect(
      screen.getByTestId(`flag-${LEGACY_MOBILE_ROUTES_FEATURE_KEY}`).textContent,
    ).toBe('false');
    expect(
      screen.getByTestId(`is-enabled-${LEGACY_MOBILE_ROUTES_FEATURE_KEY}`)
        .textContent,
    ).toBe('false');
  });
});

describe('FeatureFlagsProvider', () => {
  it('uses the documented defaults when no initialFlags are supplied', () => {
    render(
      <FeatureFlagsProvider>
        <FlagProbe flag={LEGACY_MOBILE_ROUTES_FEATURE_KEY} />
      </FeatureFlagsProvider>,
    );

    expect(
      screen.getByTestId(`flag-${LEGACY_MOBILE_ROUTES_FEATURE_KEY}`).textContent,
    ).toBe('false');
  });

  it('honours an explicit initialFlags map', () => {
    render(
      <FeatureFlagsProvider initialFlags={{ legacy_mobile_routes: true }}>
        <FlagProbe flag={LEGACY_MOBILE_ROUTES_FEATURE_KEY} />
      </FeatureFlagsProvider>,
    );

    expect(
      screen.getByTestId(`flag-${LEGACY_MOBILE_ROUTES_FEATURE_KEY}`).textContent,
    ).toBe('true');
    expect(
      screen.getByTestId(`is-enabled-${LEGACY_MOBILE_ROUTES_FEATURE_KEY}`)
        .textContent,
    ).toBe('true');
  });

  it('merges partial initialFlags with the documented defaults', () => {
    // Supplying an empty object should not strip the well-known keys.
    render(
      <FeatureFlagsProvider initialFlags={{}}>
        <FlagProbe flag={LEGACY_MOBILE_ROUTES_FEATURE_KEY} />
      </FeatureFlagsProvider>,
    );

    const keys = screen.getByTestId('flags-keys').textContent ?? '';
    expect(keys.split(',')).toContain(LEGACY_MOBILE_ROUTES_FEATURE_KEY);
    expect(
      screen.getByTestId(`flag-${LEGACY_MOBILE_ROUTES_FEATURE_KEY}`).textContent,
    ).toBe('false');
  });

  it('exposes a frozen flag map so consumers cannot mutate shared state', () => {
    let captured: Record<string, boolean> | null = null;

    function Capture() {
      const { flags } = useFeatureFlags();
      captured = flags as Record<string, boolean>;
      return null;
    }

    render(
      <FeatureFlagsProvider>
        <Capture />
      </FeatureFlagsProvider>,
    );

    expect(captured).not.toBeNull();
    expect(Object.isFrozen(captured!)).toBe(true);
  });
});
