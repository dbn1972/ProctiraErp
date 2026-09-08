/**
 * Platform-admin console persistence (G-704).
 *
 * The console aggregates (tenants, plugin submissions, break-glass requests)
 * were held in per-process Maps, so approvals/suspensions vanished on restart.
 * They now persist as platform-scoped documents in `control_plane_documents`
 * when DATABASE_URL is set; the Map store remains for dev/tests and is refused
 * in production by the persistence policy. Demo rows are only seeded when
 * `shouldSeedDemoData()` allows it (G-705).
 */
import {
  assertInMemoryFallbackAllowed,
  getSharedPgPool,
  PgDocumentCollection,
  type PgPoolWithConnect,
} from '@proctira/database';

import { shouldSeedDemoData } from './demo-seed-policy';

export interface KeyedStore<T extends { id: string }> {
  get(id: string): Promise<T | null>;
  list(): Promise<T[]>;
  set(value: T): Promise<T>;
  count(): Promise<number>;
}

export class InMemoryKeyedStore<T extends { id: string }> implements KeyedStore<T> {
  private readonly rows = new Map<string, T>();

  constructor(seed: T[] = []) {
    for (const row of seed) this.rows.set(row.id, row);
  }

  async get(id: string): Promise<T | null> {
    return this.rows.get(id) ?? null;
  }

  async list(): Promise<T[]> {
    return Array.from(this.rows.values());
  }

  async set(value: T): Promise<T> {
    this.rows.set(value.id, value);
    return value;
  }

  async count(): Promise<number> {
    return this.rows.size;
  }
}

export class PgKeyedStore<T extends { id: string }> implements KeyedStore<T> {
  private readonly docs: PgDocumentCollection<T>;

  constructor(pool: PgPoolWithConnect, collection: string) {
    // Console rows use ISO strings for timestamps; keep them as-is.
    this.docs = new PgDocumentCollection<T>(pool, collection, { reviveDates: false });
  }

  get(id: string): Promise<T | null> {
    return this.docs.get(id);
  }

  list(): Promise<T[]> {
    return this.docs.all();
  }

  set(value: T): Promise<T> {
    return this.docs.put(value.id, value);
  }

  count(): Promise<number> {
    return this.docs.count();
  }
}

export interface PlatformAdminStores<TTenant extends { id: string }, TPlugin extends { id: string }, TBreakGlass extends { id: string }> {
  tenants: KeyedStore<TTenant>;
  plugins: KeyedStore<TPlugin>;
  breakGlass: KeyedStore<TBreakGlass>;
  persistence: 'postgres' | 'memory';
}

export interface PlatformAdminSeed<TTenant, TPlugin, TBreakGlass> {
  tenants: () => TTenant[];
  plugins: () => TPlugin[];
  breakGlass: () => TBreakGlass[];
}

export async function createPlatformAdminStores<
  TTenant extends { id: string },
  TPlugin extends { id: string },
  TBreakGlass extends { id: string },
>(
  seed: PlatformAdminSeed<TTenant, TPlugin, TBreakGlass>,
  options: { seedDemo?: boolean } = {},
): Promise<PlatformAdminStores<TTenant, TPlugin, TBreakGlass>> {
  const seedDemo = options.seedDemo ?? shouldSeedDemoData();
  const pool = getSharedPgPool();

  if (pool) {
    const stores: PlatformAdminStores<TTenant, TPlugin, TBreakGlass> = {
      tenants: new PgKeyedStore<TTenant>(pool, 'platform_admin.tenants'),
      plugins: new PgKeyedStore<TPlugin>(pool, 'platform_admin.plugins'),
      breakGlass: new PgKeyedStore<TBreakGlass>(pool, 'platform_admin.break_glass'),
      persistence: 'postgres',
    };
    if (seedDemo) {
      // Seed only an empty console so real rows are never overwritten.
      if ((await stores.tenants.count()) === 0) {
        for (const row of seed.tenants()) await stores.tenants.set(row);
      }
      if ((await stores.plugins.count()) === 0) {
        for (const row of seed.plugins()) await stores.plugins.set(row);
      }
      if ((await stores.breakGlass.count()) === 0) {
        for (const row of seed.breakGlass()) await stores.breakGlass.set(row);
      }
    }
    return stores;
  }

  assertInMemoryFallbackAllowed('platform-admin-console');
  return {
    tenants: new InMemoryKeyedStore<TTenant>(seedDemo ? seed.tenants() : []),
    plugins: new InMemoryKeyedStore<TPlugin>(seedDemo ? seed.plugins() : []),
    breakGlass: new InMemoryKeyedStore<TBreakGlass>(seedDemo ? seed.breakGlass() : []),
    persistence: 'memory',
  };
}
