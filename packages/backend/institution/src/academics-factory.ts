/**
 * G-901 — composition for the institution "academics" sub-domains that were
 * defined in this package but never mounted on the gateway:
 *
 *   /academic-periods · /grades · /classes · /subjects · /institution-subjects
 *   /infrastructure/*  (land → building → floor → room, condition options)
 *
 *   - `DATABASE_URL` set → real Prisma client (academics) + raw-pg stores
 *     (infrastructure, db/sql/027, RLS via withPgTenant)
 *   - otherwise          → in-memory Prisma look-alike + tenant-partitioned
 *     in-memory infrastructure stores (dev / unit tests)
 */
import {
  assertInMemoryFallbackAllowed,
  createPrismaClient,
  getSharedPgPool,
  type PrismaClient,
} from '@proctira/database';

import { createInMemoryAcademicsPrisma } from './education/in-memory-prisma-lite.js';
import {
  InMemoryConditionOptionStore,
  InMemoryInfrastructureStore,
} from './infrastructure/in-memory-store.js';
import {
  ensureInfrastructureSchema,
  PgConditionOptionStore,
  PgInfrastructureStore,
} from './infrastructure/pg-store.js';
import type { InfrastructureTypeValue } from './infrastructure/schemas.js';
import type {
  ConditionOptionRecord,
  ConditionOptionStore,
  InfrastructureRecord,
  InfrastructureStore,
} from './infrastructure/service.js';
import type { InstitutionRepository } from './institution-repository.js';
import { createTenantBoundPrisma } from './tenant-bound-prisma.js';
import { currentTenantId } from './tenant-context.js';

export interface AcademicsDeps {
  prisma: PrismaClient;
  infrastructureStore: InfrastructureStore;
  conditionStore: ConditionOptionStore;
  /** 'prisma+pg' when DATABASE_URL is set, else 'in-memory'. */
  persistence: 'prisma+pg' | 'in-memory';
}

export interface AcademicsDepsConfig {
  databaseUrl?: string;
  /** Needed so in-memory class/subject validation sees `/institutions` rows. */
  institutionRepository?: InstitutionRepository;
  /** Prisma client to reuse (tests / gateway). Created from DATABASE_URL when omitted. */
  prisma?: PrismaClient;
}

/**
 * In-memory infrastructure store partitioned by the request tenant so the
 * fallback path still isolates tenants like the RLS-backed pg store.
 */
export class TenantPartitionedInfrastructureStore implements InfrastructureStore {
  private readonly partitions = new Map<string, InMemoryInfrastructureStore>();

  private part(): InMemoryInfrastructureStore {
    const key = currentTenantId() ?? '__no_tenant__';
    let store = this.partitions.get(key);
    if (!store) {
      store = new InMemoryInfrastructureStore();
      this.partitions.set(key, store);
    }
    return store;
  }

  create(record: InfrastructureRecord) {
    return this.part().create(record);
  }
  findById(id: string) {
    return this.part().findById(id);
  }
  findByInstitutionAndType(
    institutionId: string,
    type: InfrastructureTypeValue,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ) {
    return this.part().findByInstitutionAndType(institutionId, type, options);
  }
  findByParent(
    parentId: string,
    type: InfrastructureTypeValue,
    options: { page: number; pageSize: number; sortBy: string; sortOrder: 'asc' | 'desc' },
  ) {
    return this.part().findByParent(parentId, type, options);
  }
  findAllByInstitution(institutionId: string) {
    return this.part().findAllByInstitution(institutionId);
  }
  update(
    id: string,
    data: Partial<
      Pick<InfrastructureRecord, 'name' | 'capacity' | 'condition' | 'description' | 'updatedAt'>
    >,
  ) {
    return this.part().update(id, data);
  }
  delete(id: string) {
    return this.part().delete(id);
  }
  hasChildren(id: string) {
    return this.part().hasChildren(id);
  }
}

export class TenantPartitionedConditionOptionStore implements ConditionOptionStore {
  private readonly partitions = new Map<string, InMemoryConditionOptionStore>();

  private part(): InMemoryConditionOptionStore {
    const key = currentTenantId() ?? '__no_tenant__';
    let store = this.partitions.get(key);
    if (!store) {
      store = new InMemoryConditionOptionStore();
      this.partitions.set(key, store);
    }
    return store;
  }

  create(record: ConditionOptionRecord) {
    return this.part().create(record);
  }
  findAll() {
    return this.part().findAll();
  }
  findByName(name: string) {
    return this.part().findByName(name);
  }
  delete(id: string) {
    return this.part().delete(id);
  }
}

export function isPgAcademicsEnabled(databaseUrl = process.env['DATABASE_URL']): boolean {
  return Boolean(databaseUrl?.trim());
}

export function createAcademicsDeps(config: AcademicsDepsConfig = {}): AcademicsDeps {
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!isPgAcademicsEnabled(databaseUrl)) {
    assertInMemoryFallbackAllowed('institution-academics');
    return {
      prisma:
        config.prisma ??
        createInMemoryAcademicsPrisma({ institutionRepository: config.institutionRepository }),
      infrastructureStore: new TenantPartitionedInfrastructureStore(),
      conditionStore: new TenantPartitionedConditionOptionStore(),
      persistence: 'in-memory',
    };
  }

  const pool = getSharedPgPool(databaseUrl);
  if (!pool) throw new Error('DATABASE_URL resolved but no pg pool could be created');
  // Fire-and-forget: CI applies 027 through apply-sql.sh; this covers local boots.
  void ensureInfrastructureSchema(pool).catch(() => undefined);

  return {
    // Every academics model op runs under withTenantTransaction (FORCE RLS).
    prisma: createTenantBoundPrisma(
      config.prisma ?? createPrismaClient({ datasourceUrl: databaseUrl }),
    ),
    infrastructureStore: new PgInfrastructureStore(pool),
    conditionStore: new PgConditionOptionStore(pool),
    persistence: 'prisma+pg',
  };
}
