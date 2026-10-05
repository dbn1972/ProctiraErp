/**
 * G-705 — single decision point for "may this process seed demo data?".
 *
 *   SEED_DEMO_DATA=1      → seed (CI, demos, local exploration); in production only when
 *                           ALLOW_DEMO_SEED_IN_PRODUCTION=1 is also set (PRC-L207), logged loudly
 *   SEED_DEMO_DATA=0      → never seed
 *   unset, production     → never seed
 *   unset, non-production → seed only when no DATABASE_URL (pure in-memory dev)
 *
 * Domain plugins call {@link shouldSeedDemoData} before writing demo rows
 * (scholarships, workflow UI, health UI seed).
 */
import { isProductionNodeEnv } from '@proctira/common/node-env';
import { createLogger } from '@proctira/logging';

export interface DemoSeedEnv {
  ALLOW_DEMO_SEED_IN_PRODUCTION?: string;
  SEED_DEMO_DATA?: string;
  NODE_ENV?: string;
  DATABASE_URL?: string;
}

let warnedProductionSeed = false;

export function shouldSeedDemoData(env: DemoSeedEnv = process.env): boolean {
  const flag = env.SEED_DEMO_DATA?.trim().toLowerCase();
  if (flag === '1' || flag === 'true') {
    if (!isProductionNodeEnv(env.NODE_ENV)) return true;
    // PRC-L207: a stray SEED_DEMO_DATA=1 must not plant the fixed-UUID demo tenant in
    // production; it takes a second, production-specific opt-in.
    const allow = env.ALLOW_DEMO_SEED_IN_PRODUCTION?.trim().toLowerCase();
    const allowed = allow === '1' || allow === 'true';
    if (!warnedProductionSeed) {
      warnedProductionSeed = true;
      createLogger({ name: 'demo-seed-policy' }).warn(
        allowed
          ? 'SEED_DEMO_DATA=1 with ALLOW_DEMO_SEED_IN_PRODUCTION=1: seeding demo data in production'
          : 'SEED_DEMO_DATA=1 ignored in production (set ALLOW_DEMO_SEED_IN_PRODUCTION=1 to override)',
      );
    }
    return allowed;
  }
  if (flag === '0' || flag === 'false') return false;
  if (isProductionNodeEnv(env.NODE_ENV)) return false;
  return !(env.DATABASE_URL && env.DATABASE_URL.trim().length > 0);
}
