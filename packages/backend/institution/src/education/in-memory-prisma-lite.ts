/**
 * In-memory PrismaClient look-alike for the academics services (G-901).
 *
 * `AcademicPeriodService`, `GradeService`, `ClassService` and `SubjectService`
 * were written directly against `PrismaClient`. Before G-901 they were only
 * reachable in the standalone service with a real database, so the gateway
 * never mounted them. This shim implements the narrow Prisma surface those
 * services use (`findUnique` / `findFirst` / `findMany` / `create` / `update` /
 * `delete` with flat equality `where`, compound-unique `where`, `deletedAt:
 * null` and single-key `orderBy`) so the routes can be mounted without
 * `DATABASE_URL` (dev / unit tests) and behave like the Prisma path.
 *
 * `institution.findFirst` delegates to the {@link InstitutionRepository} so the
 * class / subject services validate against the same in-memory institutions
 * the `/institutions` routes create.
 */
import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@proctira/database';

import type { InstitutionRepository } from '../institution-repository.js';

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;
type OrderBy = Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>;

interface FindArgs {
  where?: Where;
  orderBy?: OrderBy;
  take?: number;
  skip?: number;
}

function isPlainObject(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !(value instanceof Date);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const ta =
      a instanceof Date
        ? a.getTime()
        : a === null || a === undefined
          ? a
          : new Date(String(a)).getTime();
    const tb =
      b instanceof Date
        ? b.getTime()
        : b === null || b === undefined
          ? b
          : new Date(String(b)).getTime();
    return ta === tb;
  }
  return a === b;
}

/** Flat-equality matcher covering the operators the academics services use. */
/**
 * Applies `gt` / `gte` / `lt` / `lte` when present. Comparable values only
 * (numbers, dates, strings); anything else fails the comparison rather than
 * matching by accident.
 */
function compareMatches(actual: unknown, expected: Record<string, unknown>): boolean {
  const ops = ['gt', 'gte', 'lt', 'lte'] as const;
  for (const op of ops) {
    if (!(op in expected)) continue;
    const bound = expected[op];
    const left = comparable(actual);
    const right = comparable(bound);
    if (left === null || right === null) return false;
    if (op === 'gt' && !(left > right)) return false;
    if (op === 'gte' && !(left >= right)) return false;
    if (op === 'lt' && !(left < right)) return false;
    if (op === 'lte' && !(left <= right)) return false;
  }
  return true;
}

function comparable(value: unknown): number | string | null {
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value instanceof Date) return value.getTime();
  return null;
}

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  for (const [key, expected] of Object.entries(where)) {
    if (expected === undefined) continue;
    const actual = row[key];
    if (isPlainObject(expected)) {
      // Compound unique (`tenantId_code: { tenantId, code }`) — the row has the
      // component columns, not the synthetic key.
      if (!(key in row) && key.includes('_')) {
        if (!matches(row, expected)) return false;
        continue;
      }
      // Operator object: { not, in, notIn, equals, gt, gte, lt, lte }
      if ('equals' in expected && !valuesEqual(actual, expected['equals'])) return false;
      if ('not' in expected && valuesEqual(actual, expected['not'])) return false;
      if (Array.isArray(expected['in']) && !expected['in'].some((v) => valuesEqual(actual, v)))
        return false;
      if (Array.isArray(expected['notIn']) && expected['notIn'].some((v) => valuesEqual(actual, v)))
        return false;
      // Range operators. The area hierarchy filters subtrees by nested-set
      // bounds (`lft: { gte }`, `rgt: { lte }`); without these the operator
      // object fell through and every area matched, silently widening the
      // subtree to the whole tenant.
      if (!compareMatches(actual, expected)) return false;
      continue;
    }
    if (!valuesEqual(actual, expected)) return false;
  }
  return true;
}

function sortRows(rows: Row[], orderBy: OrderBy | undefined): Row[] {
  if (!orderBy) return rows;
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const clause of clauses) {
      for (const [field, direction] of Object.entries(clause)) {
        const av = a[field];
        const bv = b[field];
        if (valuesEqual(av, bv)) continue;
        const cmp =
          av instanceof Date && bv instanceof Date
            ? av.getTime() - bv.getTime()
            : typeof av === 'number' && typeof bv === 'number'
              ? av - bv
              : String(av).localeCompare(String(bv));
        return direction === 'desc' ? -cmp : cmp;
      }
    }
    return 0;
  });
}

class NotFoundRecord extends Error {
  code = 'P2025';
  constructor() {
    super('Record to update not found.');
  }
}

class ModelTable {
  private readonly rows = new Map<string, Row>();

  constructor(private readonly defaults: () => Row) {}

  async findUnique(args: { where: Where }): Promise<Row | null> {
    return this.findFirst(args);
  }

  async findFirst(args: FindArgs = {}): Promise<Row | null> {
    const found = sortRows(
      Array.from(this.rows.values()).filter((r) => matches(r, args.where)),
      args.orderBy,
    );
    return found[0] ? { ...found[0] } : null;
  }

  async findMany(args: FindArgs = {}): Promise<Row[]> {
    let rows = sortRows(
      Array.from(this.rows.values()).filter((r) => matches(r, args.where)),
      args.orderBy,
    );
    if (args.skip) rows = rows.slice(args.skip);
    if (args.take !== undefined) rows = rows.slice(0, args.take);
    return rows.map((r) => ({ ...r }));
  }

  async count(args: FindArgs = {}): Promise<number> {
    return Array.from(this.rows.values()).filter((r) => matches(r, args.where)).length;
  }

  async create(args: { data: Row }): Promise<Row> {
    const now = new Date();
    const row: Row = {
      ...this.defaults(),
      ...args.data,
      id: (args.data['id'] as string | undefined) ?? randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(row['id'] as string, row);
    return { ...row };
  }

  async update(args: { where: Where; data: Row }): Promise<Row> {
    const current = await this.findFirst({ where: args.where });
    if (!current) throw new NotFoundRecord();
    const next: Row = { ...current, ...args.data, updatedAt: new Date() };
    this.rows.set(next['id'] as string, next);
    return { ...next };
  }

  updateMany(args: { where?: Where; data: Row }): Promise<{ count: number }> {
    let count = 0;
    for (const [id, row] of this.rows) {
      if (matches(row, args.where)) {
        this.rows.set(id, { ...row, ...args.data, updatedAt: new Date() });
        count += 1;
      }
    }
    return Promise.resolve({ count });
  }

  async delete(args: { where: Where }): Promise<Row> {
    const current = await this.findFirst({ where: args.where });
    if (!current) throw new NotFoundRecord();
    this.rows.delete(current['id'] as string);
    return current;
  }

  async deleteMany(args: FindArgs = {}): Promise<{ count: number }> {
    let count = 0;
    for (const [id, row] of this.rows) {
      if (matches(row, args.where)) {
        this.rows.delete(id);
        count += 1;
      }
    }
    return { count };
  }
}

export interface InMemoryAcademicsPrismaOptions {
  /** Used to resolve `prisma.institution.findFirst({ where: { id, tenantId } })`. */
  institutionRepository?: InstitutionRepository;
}

/**
 * Builds the in-memory academics client. Typed as `PrismaClient` because the
 * services only touch the delegates implemented here.
 */
export function createInMemoryAcademicsPrisma(
  options: InMemoryAcademicsPrismaOptions = {},
): PrismaClient {
  const soft = () => ({ deletedAt: null });
  const tables = {
    academicPeriod: new ModelTable(() => ({
      status: 'active',
      kind: 'year',
      parentId: null,
      version: 1,
      supersedesId: null,
      ...soft(),
    })),
    enrollment: new ModelTable(() => ({ status: 'ENROLLED', classId: null, exitedAt: null })),
    grade: new ModelTable(soft),
    class: new ModelTable(() => ({ capacity: null, ...soft() })),
    subject: new ModelTable(soft),
    institutionSubject: new ModelTable(() => ({})),
    // Backs the area hierarchy routes on the in-memory path. Those routes are
    // now mounted (they previously were not registered at all), so the
    // fallback client has to carry the model they read.
    geographicArea: new ModelTable(() => ({ parentId: null, ...soft() })),
  };

  /**
   * `AreaHierarchyDbClient` needs `institution.findMany` + `count` for
   * `GET /areas/:areaId/institutions`. Both delegate to the repository so the
   * in-memory path returns the same rows `/institutions` serves.
   */
  async function listForArea(
    where: Where | undefined,
  ): Promise<{ rows: Row[]; total: number } | null> {
    const repo = options.institutionRepository;
    const tenantId = where?.['tenantId'];
    if (!repo || typeof tenantId !== 'string') return null;
    const rawAreaId = where?.['areaId'];
    const areaId = typeof rawAreaId === 'string' ? rawAreaId : undefined;
    const page = await repo.list(tenantId, areaId ? { areaId } : {}, {
      page: 1,
      pageSize: 1000,
      sortBy: 'name',
      sortOrder: 'asc',
    });
    return {
      rows: page.data.map((entity) => ({ ...entity }) as unknown as Row),
      total: page.meta.totalItems,
    };
  }

  const institution = {
    findFirst: async (args: { where?: Where } = {}): Promise<Row | null> => {
      const repo = options.institutionRepository;
      const id = args.where?.['id'];
      const tenantId = args.where?.['tenantId'];
      if (!repo || typeof id !== 'string' || typeof tenantId !== 'string') return null;
      const entity = await repo.findById(id, tenantId);
      return entity ? ({ ...entity } as unknown as Row) : null;
    },
    findUnique: async (args: { where: Where }): Promise<Row | null> => institution.findFirst(args),
    findMany: async (
      args: { where?: Where; skip?: number; take?: number } = {},
    ): Promise<Row[]> => {
      const result = await listForArea(args.where);
      if (!result) return [];
      const skip = args.skip ?? 0;
      return args.take === undefined
        ? result.rows.slice(skip)
        : result.rows.slice(skip, skip + args.take);
    },
    count: async (args: { where?: Where } = {}): Promise<number> =>
      (await listForArea(args.where))?.total ?? 0,
  };

  const client = {
    ...tables,
    institution,
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client),
  };

  return client as unknown as PrismaClient;
}
