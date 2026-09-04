#!/usr/bin/env node
/**
 * Scaffold ProctiraERP §5 domains P18–P26 (finance … lms).
 * Usage: node tools/scripts/scaffold-section5-domains.mjs [--force]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const force = process.argv.includes('--force');

const DOMAINS = [
  {
    domain: 'finance',
    schema: 'finance',
    phase: 18,
    prefix: '/fees',
    title: 'Finance / Fees',
    resources: [
      {
        name: 'FeeStructure',
        table: 'fee_structures',
        path: 'structures',
        fields: [
          { key: 'name', type: 'string' },
          { key: 'academicYear', type: 'string' },
          { key: 'amount', type: 'number' },
          { key: 'currency', type: 'string', default: 'INR' },
          { key: 'frequency', type: 'string', default: 'annual' },
          { key: 'status', type: 'string', default: 'active' },
          { key: 'institutionId', type: 'uuid', optional: true },
          { key: 'gradeId', type: 'uuid', optional: true },
        ],
      },
      {
        name: 'Invoice',
        table: 'invoices',
        path: 'invoices',
        fields: [
          { key: 'studentId', type: 'uuid' },
          { key: 'enrollmentId', type: 'uuid', optional: true },
          { key: 'feeStructureId', type: 'uuid', optional: true },
          { key: 'institutionId', type: 'uuid', optional: true },
          { key: 'amountDue', type: 'number' },
          { key: 'amountPaid', type: 'number', default: 0 },
          { key: 'currency', type: 'string', default: 'INR' },
          { key: 'dueDate', type: 'string' },
          { key: 'status', type: 'string', default: 'open' },
          { key: 'notes', type: 'text', optional: true },
        ],
      },
      {
        name: 'Payment',
        table: 'payments',
        path: 'payments',
        fields: [
          { key: 'invoiceId', type: 'uuid' },
          { key: 'studentId', type: 'uuid' },
          { key: 'amount', type: 'number' },
          { key: 'method', type: 'string', default: 'cash' },
          { key: 'reference', type: 'string', optional: true },
          { key: 'paidAt', type: 'string' },
          { key: 'recordedByUserId', type: 'uuid', optional: true },
        ],
      },
    ],
  },
  {
    domain: 'timetable',
    schema: 'timetable',
    phase: 19,
    prefix: '/timetables',
    title: 'Timetable',
    resources: [
      {
        name: 'BellPeriod',
        table: 'bell_periods',
        path: 'periods',
        fields: [
          { key: 'institutionId', type: 'uuid' },
          { key: 'name', type: 'string' },
          { key: 'periodOrder', type: 'number' },
          { key: 'startTime', type: 'string' },
          { key: 'endTime', type: 'string' },
        ],
      },
      {
        name: 'TimetableSlot',
        table: 'timetable_slots',
        path: 'slots',
        fields: [
          { key: 'institutionId', type: 'uuid' },
          { key: 'classId', type: 'uuid' },
          { key: 'subjectId', type: 'uuid' },
          { key: 'staffId', type: 'uuid' },
          { key: 'bellPeriodId', type: 'uuid' },
          { key: 'roomId', type: 'uuid', optional: true },
          { key: 'dayOfWeek', type: 'number' },
          { key: 'status', type: 'string', default: 'active' },
        ],
      },
      {
        name: 'Substitution',
        table: 'substitutions',
        path: 'substitutions',
        fields: [
          { key: 'slotId', type: 'uuid' },
          { key: 'originalStaffId', type: 'uuid' },
          { key: 'substituteStaffId', type: 'uuid' },
          { key: 'date', type: 'string' },
          { key: 'reason', type: 'text', optional: true },
        ],
      },
    ],
  },
  {
    domain: 'library',
    schema: 'library',
    phase: 20,
    prefix: '/library',
    title: 'Library',
    resources: [
      {
        name: 'LibraryTitle',
        table: 'titles',
        path: 'titles',
        fields: [
          { key: 'institutionId', type: 'uuid', optional: true },
          { key: 'title', type: 'string' },
          { key: 'author', type: 'string', optional: true },
          { key: 'isbn', type: 'string', optional: true },
          { key: 'category', type: 'string', optional: true },
        ],
      },
      {
        name: 'LibraryCopy',
        table: 'copies',
        path: 'copies',
        fields: [
          { key: 'titleId', type: 'uuid' },
          { key: 'barcode', type: 'string' },
          { key: 'status', type: 'string', default: 'available' },
        ],
      },
      {
        name: 'LibraryLoan',
        table: 'loans',
        path: 'loans',
        fields: [
          { key: 'copyId', type: 'uuid' },
          { key: 'borrowerId', type: 'uuid' },
          { key: 'borrowerType', type: 'string', default: 'student' },
          { key: 'loanedAt', type: 'string' },
          { key: 'dueAt', type: 'string' },
          { key: 'returnedAt', type: 'string', optional: true },
          { key: 'fineInvoiceId', type: 'uuid', optional: true },
          { key: 'status', type: 'string', default: 'active' },
        ],
      },
    ],
  },
  {
    domain: 'hostel',
    schema: 'hostel',
    phase: 21,
    prefix: '/hostels',
    title: 'Hostel',
    resources: [
      {
        name: 'Hostel',
        table: 'hostels',
        path: '',
        fields: [
          { key: 'institutionId', type: 'uuid' },
          { key: 'name', type: 'string' },
          { key: 'gender', type: 'string', default: 'mixed' },
          { key: 'capacity', type: 'number' },
          { key: 'status', type: 'string', default: 'active' },
        ],
      },
      {
        name: 'HostelRoom',
        table: 'rooms',
        path: 'rooms',
        fields: [
          { key: 'hostelId', type: 'uuid' },
          { key: 'name', type: 'string' },
          { key: 'beds', type: 'number' },
          { key: 'status', type: 'string', default: 'available' },
        ],
      },
      {
        name: 'HostelAllocation',
        table: 'allocations',
        path: 'allocations',
        fields: [
          { key: 'hostelId', type: 'uuid' },
          { key: 'roomId', type: 'uuid' },
          { key: 'studentId', type: 'uuid' },
          { key: 'startDate', type: 'string' },
          { key: 'endDate', type: 'string', optional: true },
          { key: 'feeInvoiceId', type: 'uuid', optional: true },
          { key: 'status', type: 'string', default: 'active' },
        ],
      },
    ],
  },
  {
    domain: 'inventory',
    schema: 'inventory',
    phase: 22,
    prefix: '/inventory',
    title: 'Inventory',
    resources: [
      {
        name: 'InventoryItem',
        table: 'items',
        path: 'items',
        fields: [
          { key: 'institutionId', type: 'uuid', optional: true },
          { key: 'sku', type: 'string' },
          { key: 'name', type: 'string' },
          { key: 'unit', type: 'string', default: 'ea' },
          { key: 'quantityOnHand', type: 'number', default: 0 },
          { key: 'reorderLevel', type: 'number', default: 0 },
          { key: 'status', type: 'string', default: 'active' },
        ],
      },
      {
        name: 'StockMovement',
        table: 'stock_movements',
        path: 'movements',
        fields: [
          { key: 'itemId', type: 'uuid' },
          { key: 'movementType', type: 'string' },
          { key: 'quantity', type: 'number' },
          { key: 'issuedToStaffId', type: 'uuid', optional: true },
          { key: 'notes', type: 'text', optional: true },
          { key: 'movedAt', type: 'string' },
        ],
      },
    ],
  },
  {
    domain: 'canteen',
    schema: 'canteen',
    phase: 23,
    prefix: '/canteen',
    title: 'Canteen / MDM',
    resources: [
      {
        name: 'MealMenu',
        table: 'meal_menus',
        path: 'menus',
        fields: [
          { key: 'institutionId', type: 'uuid' },
          { key: 'date', type: 'string' },
          { key: 'mealType', type: 'string', default: 'lunch' },
          { key: 'items', type: 'text' },
          { key: 'status', type: 'string', default: 'published' },
        ],
      },
      {
        name: 'MealServing',
        table: 'meal_servings',
        path: 'servings',
        fields: [
          { key: 'menuId', type: 'uuid' },
          { key: 'institutionId', type: 'uuid' },
          { key: 'servedCount', type: 'number' },
          { key: 'wastageCount', type: 'number', default: 0 },
          { key: 'servedAt', type: 'string' },
        ],
      },
    ],
  },
  {
    domain: 'payroll',
    schema: 'payroll',
    phase: 24,
    prefix: '/payroll',
    title: 'Payroll',
    resources: [
      {
        name: 'PayStructure',
        table: 'pay_structures',
        path: 'structures',
        fields: [
          { key: 'name', type: 'string' },
          { key: 'currency', type: 'string', default: 'INR' },
          { key: 'components', type: 'text', default: '[]' },
          { key: 'status', type: 'string', default: 'active' },
        ],
      },
      {
        name: 'PayrollRun',
        table: 'payroll_runs',
        path: 'runs',
        fields: [
          { key: 'payStructureId', type: 'uuid', optional: true },
          { key: 'periodYear', type: 'number' },
          { key: 'periodMonth', type: 'number' },
          { key: 'status', type: 'string', default: 'draft' },
          { key: 'totalAmount', type: 'number', default: 0 },
        ],
      },
      {
        name: 'Payslip',
        table: 'payslips',
        path: 'payslips',
        fields: [
          { key: 'payrollRunId', type: 'uuid' },
          { key: 'staffId', type: 'uuid' },
          { key: 'grossAmount', type: 'number' },
          { key: 'netAmount', type: 'number' },
          { key: 'status', type: 'string', default: 'generated' },
        ],
      },
    ],
  },
  {
    domain: 'alumni',
    schema: 'alumni',
    phase: 25,
    prefix: '/alumni',
    title: 'Alumni',
    resources: [
      {
        name: 'AlumniProfile',
        table: 'profiles',
        path: 'profiles',
        fields: [
          { key: 'studentId', type: 'uuid', optional: true },
          { key: 'institutionId', type: 'uuid', optional: true },
          { key: 'fullName', type: 'string' },
          { key: 'graduationYear', type: 'number' },
          { key: 'lastClassName', type: 'string', optional: true },
          { key: 'email', type: 'string', optional: true },
          { key: 'phone', type: 'string', optional: true },
          { key: 'status', type: 'string', default: 'active' },
        ],
      },
      {
        name: 'AlumniEvent',
        table: 'events',
        path: 'events',
        fields: [
          { key: 'institutionId', type: 'uuid', optional: true },
          { key: 'title', type: 'string' },
          { key: 'eventDate', type: 'string' },
          { key: 'location', type: 'string', optional: true },
          { key: 'status', type: 'string', default: 'scheduled' },
        ],
      },
    ],
  },
  {
    domain: 'lms',
    schema: 'lms',
    phase: 26,
    prefix: '/lms',
    title: 'LMS',
    resources: [
      {
        name: 'LmsCourse',
        table: 'courses',
        path: 'courses',
        fields: [
          { key: 'institutionId', type: 'uuid' },
          { key: 'classId', type: 'uuid', optional: true },
          { key: 'subjectId', type: 'uuid', optional: true },
          { key: 'staffId', type: 'uuid', optional: true },
          { key: 'title', type: 'string' },
          { key: 'status', type: 'string', default: 'draft' },
        ],
      },
      {
        name: 'LmsLesson',
        table: 'lessons',
        path: 'lessons',
        fields: [
          { key: 'courseId', type: 'uuid' },
          { key: 'title', type: 'string' },
          { key: 'contentRef', type: 'text', optional: true },
          { key: 'lessonOrder', type: 'number', default: 1 },
          { key: 'status', type: 'string', default: 'published' },
        ],
      },
      {
        name: 'LmsEnrollment',
        table: 'enrollments',
        path: 'enrollments',
        fields: [
          { key: 'courseId', type: 'uuid' },
          { key: 'studentId', type: 'uuid' },
          { key: 'status', type: 'string', default: 'active' },
          { key: 'progressPct', type: 'number', default: 0 },
        ],
      },
    ],
  },
];

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function camel(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
function snake(s) {
  return s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
}
function write(filePath, content) {
  if (fs.existsSync(filePath) && !force) {
    console.log('skip', path.relative(root, filePath));
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  console.log('write', path.relative(root, filePath));
}

function tsType(f) {
  if (f.type === 'number') return 'number';
  if (f.type === 'boolean') return 'boolean';
  return 'string';
}

function sqlType(f) {
  if (f.type === 'uuid') return 'UUID';
  if (f.type === 'number') return 'DOUBLE PRECISION';
  if (f.type === 'boolean') return 'BOOLEAN';
  if (f.type === 'text') return 'TEXT';
  return 'VARCHAR(255)';
}

function prismaType(f) {
  if (f.type === 'number') return { typ: 'Float', db: '' };
  if (f.type === 'boolean') return { typ: 'Boolean', db: '' };
  if (f.type === 'uuid') return { typ: 'String', db: ' @db.Uuid' };
  if (f.type === 'text') return { typ: 'String', db: ' @db.Text' };
  return { typ: 'String', db: ' @db.VarChar(255)' };
}

function prismaDefault(f) {
  if (f.default === undefined) return '';
  if (typeof f.default === 'number' || typeof f.default === 'boolean') return ` @default(${f.default})`;
  return ` @default("${f.default}")`;
}

function sqlDefault(f) {
  if (f.default === undefined) return '';
  if (typeof f.default === 'number' || typeof f.default === 'boolean') return ` DEFAULT ${f.default}`;
  return ` DEFAULT '${f.default}'`;
}

for (const d of DOMAINS) {
  const pkgDir = path.join(root, 'packages/backend', d.domain);
  const src = path.join(pkgDir, 'src');
  const D = cap(d.domain);

  write(
    path.join(pkgDir, 'package.json'),
    JSON.stringify(
      {
        name: `@proctira/backend-${d.domain}`,
        version: '0.1.0',
        private: true,
        main: './src/index.ts',
        types: './src/index.ts',
        exports: { '.': './src/index.ts' },
        scripts: {
          build: 'tsc --noEmit',
          test: 'vitest run',
          lint: 'eslint src/',
          clean: 'rm -rf dist',
          typecheck: 'tsc --noEmit',
        },
        dependencies: {
          '@proctira/common': 'workspace:*',
          '@proctira/database': 'workspace:*',
          '@proctira/logging': 'workspace:*',
          '@proctira/validation': 'workspace:*',
          '@prisma/client': '^5.22.0',
          '@sinclair/typebox': '^0.32.0',
          'fastify-plugin': '^4.5.0',
          uuid: '^9.0.0',
        },
        devDependencies: {
          '@types/node': '^20.12.0',
          '@types/uuid': '^9.0.8',
          fastify: '^4.26.0',
          typescript: '^5.4.0',
          vitest: '^1.6.0',
        },
        peerDependencies: { fastify: '^4.0.0' },
      },
      null,
      2,
    ) + '\n',
  );

  write(
    path.join(pkgDir, 'tsconfig.json'),
    `{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "composite": false,
    "declaration": false,
    "declarationMap": false,
    "noEmit": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts", "src/**/*.spec.ts"]
}
`,
  );

  write(
    path.join(pkgDir, 'vitest.config.ts'),
    `import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname),
    include: ['src/**/*.{test,spec}.ts'],
    passWithNoTests: true,
  },
});
`,
  );

  // repository types
  let repo = `/** ${d.title} repository ports (P${d.phase}). */\n\n`;
  for (const r of d.resources) {
    repo += `export interface ${r.name}Entity {\n  id: string;\n  tenantId: string;\n`;
    for (const f of r.fields) {
      repo += `  ${f.key}: ${tsType(f)}${f.optional ? ' | null' : ''};\n`;
    }
    repo += `  createdAt: string;\n  updatedAt: string;\n}\n\n`;
  }
  repo += `export interface ${D}Repository {\n`;
  for (const r of d.resources) {
    repo += `  list${r.name}s(tenantId: string): Promise<${r.name}Entity[]>;\n`;
    repo += `  get${r.name}(tenantId: string, id: string): Promise<${r.name}Entity | null>;\n`;
    repo += `  create${r.name}(row: ${r.name}Entity): Promise<${r.name}Entity>;\n`;
    repo += `  update${r.name}(tenantId: string, id: string, patch: Partial<${r.name}Entity>): Promise<${r.name}Entity | null>;\n`;
  }
  repo += `}\n`;
  write(path.join(src, `${d.domain}-repository.ts`), repo);

  // in-memory
  let mem = `import type {\n`;
  for (const r of d.resources) mem += `  ${r.name}Entity,\n`;
  mem += `  ${D}Repository,\n} from './${d.domain}-repository.js';\n\n`;
  mem += `export class InMemory${D}Repository implements ${D}Repository {\n`;
  for (const r of d.resources) mem += `  private readonly ${camel(r.name)}s = new Map<string, ${r.name}Entity>();\n`;
  mem += '\n';
  for (const r of d.resources) {
    const m = `this.${camel(r.name)}s`;
    mem += `  async list${r.name}s(tenantId: string) {\n    return [...${m}.values()].filter((x) => x.tenantId === tenantId);\n  }\n`;
    mem += `  async get${r.name}(tenantId: string, id: string) {\n    const row = ${m}.get(id);\n    return row?.tenantId === tenantId ? row : null;\n  }\n`;
    mem += `  async create${r.name}(row: ${r.name}Entity) {\n    ${m}.set(row.id, row);\n    return row;\n  }\n`;
    mem += `  async update${r.name}(tenantId: string, id: string, patch: Partial<${r.name}Entity>) {\n    const cur = await this.get${r.name}(tenantId, id);\n    if (!cur) return null;\n    const next = { ...cur, ...patch, id: cur.id, tenantId: cur.tenantId, updatedAt: new Date().toISOString() };\n    ${m}.set(id, next);\n    return next;\n  }\n`;
  }
  mem += `}\n`;
  write(path.join(src, 'in-memory-repository.ts'), mem);

  // prisma repo
  let pr = `import type { PrismaClient } from '@proctira/database';\nimport type {\n`;
  for (const r of d.resources) pr += `  ${r.name}Entity,\n`;
  pr += `  ${D}Repository,\n} from './${d.domain}-repository.js';\n\nfunction iso(v: Date | string) {\n  return v instanceof Date ? v.toISOString() : v;\n}\n\n`;
  pr += `export class Prisma${D}Repository implements ${D}Repository {\n  constructor(private readonly prisma: PrismaClient) {}\n\n`;
  for (const r of d.resources) {
    const model = camel(r.name);
    pr += `  async list${r.name}s(tenantId: string) {\n    const rows = await (this.prisma as any).${model}.findMany({ where: { tenantId } });\n    return rows.map(map${r.name});\n  }\n`;
    pr += `  async get${r.name}(tenantId: string, id: string) {\n    const row = await (this.prisma as any).${model}.findFirst({ where: { id, tenantId } });\n    return row ? map${r.name}(row) : null;\n  }\n`;
    pr += `  async create${r.name}(row: ${r.name}Entity) {\n    const created = await (this.prisma as any).${model}.create({ data: to${r.name}(row) });\n    return map${r.name}(created);\n  }\n`;
    pr += `  async update${r.name}(tenantId: string, id: string, patch: Partial<${r.name}Entity>) {\n    const existing = await this.get${r.name}(tenantId, id);\n    if (!existing) return null;\n    const updated = await (this.prisma as any).${model}.update({\n      where: { id },\n      data: to${r.name}({ ...existing, ...patch, id, tenantId }),\n    });\n    return map${r.name}(updated);\n  }\n`;
  }
  pr += `}\n\n`;
  for (const r of d.resources) {
    pr += `function map${r.name}(row: any): ${r.name}Entity {\n  return {\n    id: row.id,\n    tenantId: row.tenantId,\n`;
    for (const f of r.fields) pr += `    ${f.key}: row.${f.key}${f.optional ? ' ?? null' : ''},\n`;
    pr += `    createdAt: iso(row.createdAt),\n    updatedAt: iso(row.updatedAt),\n  };\n}\n`;
    pr += `function to${r.name}(row: ${r.name}Entity) {\n  return {\n    id: row.id,\n    tenantId: row.tenantId,\n`;
    for (const f of r.fields) pr += `    ${f.key}: row.${f.key}${f.optional ? ' ?? null' : ''},\n`;
    pr += `    createdAt: new Date(row.createdAt),\n    updatedAt: new Date(row.updatedAt),\n  };\n}\n`;
  }
  write(path.join(src, `prisma-${d.domain}-repository.ts`), pr);

  write(
    path.join(src, 'repository-factory.ts'),
    `import { createPrismaClient } from '@proctira/database';\nimport { InMemory${D}Repository } from './in-memory-repository.js';\nimport { Prisma${D}Repository } from './prisma-${d.domain}-repository.js';\nimport type { ${D}Repository } from './${d.domain}-repository.js';\n\nexport interface ${D}RepositoryConfig {\n  databaseUrl?: string;\n}\n\nexport function create${D}Repository(config: ${D}RepositoryConfig = {}): ${D}Repository {\n  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];\n  if (!databaseUrl) return new InMemory${D}Repository();\n  return new Prisma${D}Repository(createPrismaClient({ datasourceUrl: databaseUrl }));\n}\n`,
  );

  // service
  let svc = `import { randomUUID } from 'node:crypto';\nimport type {\n`;
  for (const r of d.resources) svc += `  ${r.name}Entity,\n`;
  svc += `  ${D}Repository,\n} from './${d.domain}-repository.js';\n\nexport class ${D}Service {\n  constructor(private readonly repo: ${D}Repository) {}\n\n`;
  for (const r of d.resources) {
    svc += `  list${r.name}s(tenantId: string) {\n    return this.repo.list${r.name}s(tenantId);\n  }\n`;
    svc += `  get${r.name}(tenantId: string, id: string) {\n    return this.repo.get${r.name}(tenantId, id);\n  }\n`;
    svc += `  create${r.name}(\n    tenantId: string,\n    input: Omit<${r.name}Entity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,\n  ) {\n    const now = new Date().toISOString();\n    return this.repo.create${r.name}({\n      id: randomUUID(),\n      tenantId,\n      ...input,\n      createdAt: now,\n      updatedAt: now,\n    } as ${r.name}Entity);\n  }\n`;
    svc += `  update${r.name}(tenantId: string, id: string, patch: Partial<${r.name}Entity>) {\n    return this.repo.update${r.name}(tenantId, id, patch);\n  }\n`;
  }
  svc += `}\n`;
  write(path.join(src, `${d.domain}-service.ts`), svc);

  // routes
  let routes = `import type { FastifyInstance, FastifyRequest } from 'fastify';\nimport { ${D}Service } from './${d.domain}-service.js';\n\nexport interface ${D}RoutesOptions {\n  service: ${D}Service;\n  prefix?: string;\n}\n\nfunction tenantIdOf(request: FastifyRequest): string {\n  const user = request.user as { tenantId?: string } | undefined;\n  return (\n    user?.tenantId ??\n    (request.headers['x-tenant-id'] as string | undefined) ??\n    '00000000-0000-4000-8000-000000000001'\n  );\n}\n\nexport async function register${D}Routes(\n  fastify: FastifyInstance,\n  options: ${D}RoutesOptions,\n) {\n  const prefix = options.prefix ?? '${d.prefix}';\n  const { service } = options;\n\n`;
  for (const r of d.resources) {
    const listPath = r.path ? `\`\${prefix}/${r.path}\`` : '`${prefix}`';
    const idPath = r.path ? `\`\${prefix}/${r.path}/:id\`` : '`${prefix}/:id`';
    routes += `  fastify.get(${listPath}, async (request, reply) => {\n    const rows = await service.list${r.name}s(tenantIdOf(request));\n    return reply.send({ data: rows });\n  });\n`;
    routes += `  fastify.get(${idPath}, async (request, reply) => {\n    const { id } = request.params as { id: string };\n    const row = await service.get${r.name}(tenantIdOf(request), id);\n    if (!row) return reply.status(404).send({ error: 'not_found' });\n    return reply.send(row);\n  });\n`;
    routes += `  fastify.post(${listPath}, async (request, reply) => {\n    const row = await service.create${r.name}(tenantIdOf(request), request.body as any);\n    return reply.status(201).send(row);\n  });\n`;
    routes += `  fastify.put(${idPath}, async (request, reply) => {\n    const { id } = request.params as { id: string };\n    const row = await service.update${r.name}(tenantIdOf(request), id, request.body as any);\n    if (!row) return reply.status(404).send({ error: 'not_found' });\n    return reply.send(row);\n  });\n\n`;
  }
  routes += `}\n`;
  write(path.join(src, 'routes.ts'), routes);

  write(
    path.join(src, `${d.domain}-plugin.ts`),
    `import type { FastifyInstance } from 'fastify';\nimport fp from 'fastify-plugin';\nimport type { ${D}Repository } from './${d.domain}-repository.js';\nimport { ${D}Service } from './${d.domain}-service.js';\nimport { register${D}Routes } from './routes.js';\n\nexport interface ${D}PluginOptions {\n  repository: ${D}Repository;\n  prefix?: string;\n}\n\nexport const ${d.domain}Plugin = fp(\n  async function ${d.domain}PluginImpl(\n    fastify: FastifyInstance,\n    options: ${D}PluginOptions,\n  ) {\n    const service = new ${D}Service(options.repository);\n    await register${D}Routes(fastify, {\n      service,\n      prefix: options.prefix ?? '${d.prefix}',\n    });\n  },\n  { name: '@proctira/backend-${d.domain}', fastify: '4.x' },\n);\n`,
  );

  let index = `export { ${d.domain}Plugin } from './${d.domain}-plugin.js';\nexport type { ${D}PluginOptions } from './${d.domain}-plugin.js';\nexport { ${D}Service } from './${d.domain}-service.js';\nexport { create${D}Repository } from './repository-factory.js';\nexport type { ${D}RepositoryConfig } from './repository-factory.js';\nexport { InMemory${D}Repository } from './in-memory-repository.js';\nexport { Prisma${D}Repository } from './prisma-${d.domain}-repository.js';\nexport type { ${D}Repository } from './${d.domain}-repository.js';\n`;
  for (const r of d.resources) index += `export type { ${r.name}Entity } from './${d.domain}-repository.js';\n`;
  write(path.join(src, 'index.ts'), index);

  write(
    path.join(src, 'schema-boundary.test.ts'),
    `import fs from 'node:fs';\nimport path from 'node:path';\nimport { describe, expect, it } from 'vitest';\n\ndescribe('${d.domain} schema boundary', () => {\n  it('declares @@schema(\"${d.schema}\") in shared prisma schema', () => {\n    const schemaPath = path.resolve(\n      __dirname,\n      '../../../../shared/database/prisma/schema.prisma',\n    );\n    const src = fs.readFileSync(schemaPath, 'utf8');\n    expect(src).toContain('@@schema(\"${d.schema}\")');\n  });\n});\n`,
  );

  write(
    path.join(src, `${d.domain}-service.test.ts`),
    `import { describe, expect, it } from 'vitest';\nimport { InMemory${D}Repository } from './in-memory-repository.js';\nimport { ${D}Service } from './${d.domain}-service.js';\n\nconst tenantId = '11111111-1111-4111-8111-111111111111';\n\ndescribe('${D}Service', () => {\n  it('creates and lists ${d.resources[0].name}', async () => {\n    const service = new ${D}Service(new InMemory${D}Repository());\n    const created = await service.create${d.resources[0].name}(tenantId, {\n${d.resources[0].fields
      .map((f) => {
        if (f.optional) return null;
        if (f.type === 'number') return `      ${f.key}: ${f.default ?? 1},`;
        if (f.type === 'boolean') return `      ${f.key}: ${f.default ?? true},`;
        if (f.type === 'uuid') return `      ${f.key}: '22222222-2222-4222-8222-222222222222',`;
        return `      ${f.key}: '${f.default ?? 'sample'}',`;
      })
      .filter(Boolean)
      .join('\n')}\n    } as any);\n    expect(created.id).toBeTruthy();\n    const rows = await service.list${d.resources[0].name}s(tenantId);\n    expect(rows).toHaveLength(1);\n  });\n});\n`,
  );

  // SQL migration
  let sql = `-- Phase ${d.phase}: ${d.title}\nCREATE SCHEMA IF NOT EXISTS ${d.schema};\nCREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";\n\n`;
  for (const r of d.resources) {
    sql += `CREATE TABLE IF NOT EXISTS ${d.schema}.${r.table} (\n`;
    sql += `  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),\n`;
    sql += `  tenant_id UUID NOT NULL,\n`;
    for (const f of r.fields) {
      const col = snake(f.key);
      sql += `  ${col} ${sqlType(f)}${f.optional ? '' : ' NOT NULL'}${sqlDefault(f)},\n`;
    }
    sql += `  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n`;
    sql += `  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\n`;
    sql += `CREATE INDEX IF NOT EXISTS ${r.table}_tenant_id_idx ON ${d.schema}.${r.table} (tenant_id);\n\n`;
  }
  write(
    path.join(
      root,
      `packages/shared/database/prisma/migrations/20260904_${d.schema}_schema/migration.sql`,
    ),
    sql,
  );

  // web client + page
  const primary = d.resources[0];
  let api = `import { gatewayFetch } from './gateway';\n\nexport interface ${primary.name} {\n  id: string;\n  tenantId: string;\n`;
  for (const f of primary.fields) {
    api += `  ${f.key}: ${tsType(f)}${f.optional ? ' | null' : ''};\n`;
  }
  api += `  createdAt: string;\n  updatedAt: string;\n}\n\n`;
  const seg = primary.path ? `${d.prefix}/${primary.path}` : d.prefix;
  api += `export async function list${primary.name}s(): Promise<${primary.name}[]> {\n  try {\n    const res = await gatewayFetch<{ data: ${primary.name}[] }>('${seg}');\n    return Array.isArray(res) ? res : (res.data ?? []);\n  } catch {\n    return [];\n  }\n}\n`;
  write(path.join(root, `apps/web/src/lib/api/${d.domain}.ts`), api);

  write(
    path.join(root, `apps/web/src/app/(dashboard)/${d.domain}/page.tsx`),
    `import { list${primary.name}s } from '@/lib/api/${d.domain}';\n\nexport const dynamic = 'force-dynamic';\n\nexport default async function ${D}Page() {\n  const rows = await list${primary.name}s();\n  return (\n    <section className="space-y-6" aria-labelledby="${d.domain}-heading">\n      <div>\n        <h1 id="${d.domain}-heading" className="text-3xl font-extrabold tracking-tight">\n          ${d.title}\n        </h1>\n        <p className="mt-1 text-sm text-muted-foreground">\n          Phase ${d.phase} MVP — ${primary.name} list\n        </p>\n      </div>\n      <div className="overflow-hidden rounded-lg border border-border">\n        <table className="w-full text-sm">\n          <thead>\n            <tr className="border-b border-border text-left text-muted-foreground">\n              <th className="p-3">ID</th>\n              <th className="p-3">Details</th>\n            </tr>\n          </thead>\n          <tbody>\n            {rows.length === 0 ? (\n              <tr>\n                <td className="p-3 text-muted-foreground" colSpan={2}>\n                  No records yet.\n                </td>\n              </tr>\n            ) : (\n              rows.map((row) => (\n                <tr key={row.id} className="border-b border-border">\n                  <td className="p-3 font-mono text-xs">{row.id.slice(0, 8)}</td>\n                  <td className="p-3 font-mono text-xs">{JSON.stringify(row).slice(0, 140)}</td>\n                </tr>\n              ))\n            )}\n          </tbody>\n        </table>\n      </div>\n    </section>\n  );\n}\n`,
  );

  write(
    path.join(root, `docs/PHASE_${d.phase}_${d.domain.toUpperCase()}_SIGNOFF.md`),
    `# Phase ${d.phase} — ProctiraERP ${d.title} sign-off\n\n**Status:** MVP scaffolded (API + web list).\n\n| Stream | Result |\n|--------|--------|\n| Schema | \`${d.schema}\` |\n| Tables | ${d.resources.map((r) => '`' + r.table + '`').join(', ')} |\n| Boundaries | Bare \`tenant_id\` + cross-domain UUIDs (no Tenant FKs) |\n| Gateway | \`${d.prefix}\` via \`@proctira/backend-${d.domain}\` |\n| Web | \`/(dashboard)/${d.domain}\` |\n\nNon-goals: see [plans/CHARTER_EXPANSION_SECTION5.md](./plans/CHARTER_EXPANSION_SECTION5.md).\n`,
  );
}

// Prisma fragment
let fragment = '// --- §5 P18–P26 models ---\n\n';
for (const d of DOMAINS) {
  for (const r of d.resources) {
    fragment += `model ${r.name} {\n`;
    fragment += `  id        String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid\n`;
    fragment += `  tenantId  String   @map("tenant_id") @db.Uuid\n`;
    for (const f of r.fields) {
      const { typ, db } = prismaType(f);
      const opt = f.optional ? '?' : '';
      fragment += `  ${f.key} ${typ}${opt}${prismaDefault(f)} @map("${snake(f.key)}")${db}\n`;
    }
    fragment += `  createdAt DateTime @default(now()) @map("created_at")\n`;
    fragment += `  updatedAt DateTime @updatedAt @map("updated_at")\n`;
    fragment += `  @@index([tenantId])\n`;
    fragment += `  @@map("${r.table}")\n`;
    fragment += `  @@schema("${d.schema}")\n}\n\n`;
  }
}
write(path.join(root, 'tools/scripts/section5-prisma-models.prisma.fragment'), fragment);
write(
  path.join(root, 'tools/scripts/section5-domains.json'),
  JSON.stringify(
    DOMAINS.map((d) => ({
      domain: d.domain,
      schema: d.schema,
      phase: d.phase,
      prefix: d.prefix,
      package: `@proctira/backend-${d.domain}`,
    })),
    null,
    2,
  ) + '\n',
);

console.log('Scaffolded', DOMAINS.length, 'domains');
