/**
 * PRC-L498: shared faker instance for all factories.
 *
 * When `FC_SEED` (the same seed fast-check runs use) is a valid integer, faker is
 * seeded once at import so factory output is reproducible across runs. Call
 * {@link seedFactories} to reseed explicitly inside a test.
 */
import { faker } from '@faker-js/faker';

/** Parses `FC_SEED`; returns undefined when unset or not an integer. */
export function resolveFactorySeed(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env['FC_SEED']?.trim();
  if (!raw) return undefined;
  const seed = Number(raw);
  return Number.isInteger(seed) ? seed : undefined;
}

/** Reseeds the shared faker instance used by every factory. */
export function seedFactories(seed: number): void {
  faker.seed(seed);
}

const envSeed = resolveFactorySeed();
if (envSeed !== undefined) seedFactories(envSeed);

export { faker };
