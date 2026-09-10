/**
 * Property-based testing helpers for Vitest + fast-check integration.
 * Provides seed-based reproducibility and convenient assertion wrappers.
 */

import * as fc from 'fast-check';

/**
 * Default fast-check parameters for property tests.
 * Uses seed from environment variable for reproducibility in CI.
 */
export function getDefaultParameters(): fc.Parameters<unknown> {
  const seedEnv = process.env['FC_SEED'];
  const seed = seedEnv ? parseInt(seedEnv, 10) : undefined;

  return {
    numRuns: parseInt(process.env['FC_NUM_RUNS'] ?? '100', 10),
    seed,
    verbose:
      process.env['FC_VERBOSE'] === 'true' ? fc.VerbosityLevel.Verbose : fc.VerbosityLevel.None,
    endOnFailure: true,
  };
}

/**
 * Runs a property-based test assertion with default parameters.
 * Automatically uses seed from FC_SEED env var for reproducibility.
 *
 * @example
 * ```ts
 * it('addition is commutative', () => {
 *   assertProperty(
 *     fc.tuple(fc.integer(), fc.integer()),
 *     ([a, b]) => {
 *       expect(a + b).toBe(b + a);
 *     }
 *   );
 * });
 * ```
 */
export function assertProperty<T>(
  arbitrary: fc.Arbitrary<T>,
  predicate: (value: T) => void | boolean,
  overrides?: Partial<fc.Parameters<unknown>>,
): void {
  const params = { ...getDefaultParameters(), ...overrides };
  fc.assert(fc.property(arbitrary, predicate), params);
}

/**
 * Runs a property test with a specific seed for reproducibility.
 * Useful for reproducing failures found in CI.
 *
 * @example
 * ```ts
 * it('reproduces a specific failure', () => {
 *   withSeed(12345, () => {
 *     assertProperty(fc.integer(), (n) => {
 *       expect(n * 2).toBe(n + n);
 *     });
 *   });
 * });
 * ```
 */
export function withSeed(seed: number, fn: () => void): void {
  const originalSeed = process.env['FC_SEED'];
  process.env['FC_SEED'] = String(seed);
  try {
    fn();
  } finally {
    if (originalSeed !== undefined) {
      process.env['FC_SEED'] = originalSeed;
    } else {
      delete process.env['FC_SEED'];
    }
  }
}

/**
 * Creates a property test runner with custom parameters.
 * Useful for tests that need more or fewer runs.
 *
 * @example
 * ```ts
 * const quickCheck = createPropertyRunner({ numRuns: 50 });
 * quickCheck(fc.integer(), (n) => expect(n + 0).toBe(n));
 * ```
 */
export function createPropertyRunner(overrides: Partial<fc.Parameters<unknown>> = {}) {
  return function runProperty<T>(
    arb: fc.Arbitrary<T>,
    predicate: (value: T) => void | boolean,
  ): void {
    const params = { ...getDefaultParameters(), ...overrides };
    fc.assert(fc.property(arb, predicate), params);
  };
}

/**
 * Re-export fast-check for convenience so tests only need to import from @proctira/testing.
 */
export { fc };
