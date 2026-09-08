/**
 * G-705 — single decision point for "may this process seed demo data?".
 *
 *   SEED_DEMO_DATA=1      → always seed (CI, demos, local exploration)
 *   SEED_DEMO_DATA=0      → never seed
 *   unset, production     → never seed
 *   unset, non-production → seed only when no DATABASE_URL (pure in-memory dev)
 *
 * Domain plugins call {@link shouldSeedDemoData} before writing demo rows
 * (scholarships, workflow UI, health UI seed).
 */
export interface DemoSeedEnv {
  SEED_DEMO_DATA?: string;
  NODE_ENV?: string;
  DATABASE_URL?: string;
}

export function shouldSeedDemoData(env: DemoSeedEnv = process.env): boolean {
  const flag = env.SEED_DEMO_DATA?.trim().toLowerCase();
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  if (env.NODE_ENV === 'production') return false;
  return !(env.DATABASE_URL && env.DATABASE_URL.trim().length > 0);
}
