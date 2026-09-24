/**
 * Types for the `vitest-axe` matchers registered in `src/test-setup.ts`.
 *
 * `vitest-axe@0.1.0` ships the matcher implementations but no module augmentation for
 * Vitest's `Assertion`, so `expect(results).toHaveNoViolations()` is a type error even
 * though it works at runtime. `packages/ui/components` never hit this because its tsconfig
 * leaves test files out of type-checking; `apps/web` type-checks its tests, which is the
 * better posture and the reason this file has to exist.
 *
 * Declared here rather than suppressed with a `@ts-expect-error` at each call site: an
 * assertion nobody can see the type of is the kind of thing that quietly stops asserting.
 *
 * The `export {}` is load-bearing. Without a top-level import or export this file is a global
 * script, which makes `declare module 'vitest'` an ambient declaration that *replaces* the real
 * module instead of augmenting it — every `import { describe } from 'vitest'` in the app then
 * fails with TS2305.
 */
export {};

declare module 'vitest' {
  interface Assertion {
    /** Fails when `axe()` reported any violation, printing each rule and node. */
    toHaveNoViolations(): void;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): void;
  }
}
