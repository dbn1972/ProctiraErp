/**
 * PRC-H077: the deny-by-default wipe / erasure registries are checked against
 * the real migration catalogue (db/sql + Prisma migrations), so a new
 * tenant-scoped or subject-linked table cannot ship unclassified.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  SUBJECT_LINK_COLUMNS,
  SUBJECT_LINK_REGISTRY,
  TENANT_WIPE_REGISTRY,
  tenantWipeDisposition,
  type SubjectKind,
} from './tenant-data-registry.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

interface ForeignKey {
  from: string;
  to: string;
  onDelete: string;
}

interface Catalogue {
  columns: Map<string, Set<string>>;
  foreignKeys: ForeignKey[];
}

function migrationFiles(): string[] {
  const files: string[] = [];
  const sqlDir = join(root, 'db/sql');
  for (const f of readdirSync(sqlDir).sort()) {
    if (/^\d.*\.sql$/.test(f)) files.push(join(sqlDir, f));
  }
  const prismaDir = join(root, 'packages/shared/database/prisma/migrations');
  for (const d of readdirSync(prismaDir).sort()) {
    const p = join(prismaDir, d, 'migration.sql');
    if (existsSync(p)) files.push(p);
  }
  return files;
}

const IDENT = String.raw`(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?`;

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

function onDeleteOf(text: string): string {
  const m = /ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/i.exec(text);
  return m ? m[1]!.toUpperCase().replace(/\s+/g, ' ') : 'NO ACTION';
}

function loadCatalogue(): Catalogue {
  const columns = new Map<string, Set<string>>();
  const foreignKeys: ForeignKey[] = [];
  const addCol = (t: string, c: string) => {
    const set = columns.get(t) ?? new Set<string>();
    set.add(c);
    columns.set(t, set);
  };
  for (const file of migrationFiles()) {
    const sql = readFileSync(file, 'utf8').replace(/--[^\n]*/g, '');
    const create = new RegExp(
      String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}\s*\(`,
      'gi',
    );
    let m: RegExpExecArray | null;
    while ((m = create.exec(sql))) {
      const table = m[1]!.toLowerCase();
      let depth = 1;
      let i = create.lastIndex;
      for (; i < sql.length && depth > 0; i += 1) {
        if (sql[i] === '(') depth += 1;
        else if (sql[i] === ')') depth -= 1;
      }
      for (const part of splitTopLevel(sql.slice(create.lastIndex, i - 1))) {
        const col = /^\s*"?([a-z_][a-z0-9_]*)"?\s+/i.exec(part);
        const ref = new RegExp(String.raw`REFERENCES\s+${IDENT}`, 'i').exec(part);
        if (ref)
          foreignKeys.push({ from: table, to: ref[1]!.toLowerCase(), onDelete: onDeleteOf(part) });
        if (col && !/^(constraint|primary|unique|foreign|check|exclude|like)$/i.test(col[1]!)) {
          addCol(table, col[1]!.toLowerCase());
        }
      }
    }
    // Data-driven FK migrations (071/073/085/087): ('table', 'col', 'name', 'FOREIGN KEY … REFERENCES x(…) …').
    const tuple =
      /\(\s*'([a-z_][a-z0-9_]*)'\s*,[^()]*?'FOREIGN KEY\s*\([^)]*\)\s*REFERENCES\s+([a-z_][a-z0-9_]*)\s*\([^)]*\)([^']*)'/gi;
    for (const t of sql.matchAll(tuple)) {
      foreignKeys.push({
        from: t[1]!.toLowerCase(),
        to: t[2]!.toLowerCase(),
        onDelete: onDeleteOf(t[3]!),
      });
    }
    for (const stmt of sql.split(';')) {
      const alter = new RegExp(
        String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${IDENT}\s+([\s\S]*)`,
        'i',
      ).exec(stmt);
      if (!alter) continue;
      const table = alter[1]!.toLowerCase();
      const rest = alter[2]!;
      for (const c of rest.matchAll(
        /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi,
      )) {
        addCol(table, c[1]!.toLowerCase());
      }
      for (const clause of splitTopLevel(rest)) {
        const ref = new RegExp(String.raw`REFERENCES\s+${IDENT}`, 'i').exec(clause);
        if (ref)
          foreignKeys.push({
            from: table,
            to: ref[1]!.toLowerCase(),
            onDelete: onDeleteOf(clause),
          });
      }
    }
  }
  return { columns, foreignKeys };
}

const catalogue = loadCatalogue();
const tenantTables = [...catalogue.columns]
  .filter(([, cols]) => cols.has('tenant_id'))
  .map(([t]) => t)
  .sort();
const privileges = JSON.parse(
  readFileSync(join(root, 'db/runtime-table-privileges.json'), 'utf8'),
) as { tables: Record<string, string> };

describe('tenant wipe registry vs migration catalogue (PRC-H077)', () => {
  it('parses a realistic catalogue', () => {
    expect(tenantTables.length).toBeGreaterThan(200);
    expect(tenantTables).toContain('students');
    expect(tenantTables).toContain('staff_payroll_runs');
    const fk = (from: string, to: string) =>
      catalogue.foreignKeys.filter((f) => f.from === from && f.to === to).map((f) => f.onDelete);
    // Inline, ALTER-based and data-driven tuple FKs are all parsed.
    expect(fk('student_photos', 'students')).toContain('CASCADE');
    expect(fk('grade_change_audit', 'grade_entries')).toContain('CASCADE');
    expect(fk('parent_fee_invoices', 'students')).toContain('NO ACTION');
    expect(fk('hostel_leaves', 'students')).toContain('NO ACTION');
  });

  it('classifies every tenant-scoped table exactly once (deny by default)', () => {
    const unclassified = tenantTables.filter((t) => !TENANT_WIPE_REGISTRY.has(t));
    expect(unclassified).toEqual([]);
  });

  it('has no stale registry entries for tables absent from the catalogue', () => {
    const known = new Set(tenantTables);
    expect([...TENANT_WIPE_REGISTRY.keys()].filter((t) => !known.has(t))).toEqual([]);
  });

  it('never wipes a table the runtime role cannot DELETE (immutable ledgers/audits)', () => {
    const wipedNonDml = [...TENANT_WIPE_REGISTRY]
      .filter(([, d]) => d.action === 'wipe')
      .map(([t]) => t)
      .filter((t) => privileges.tables[t] !== 'dml');
    expect(wipedNonDml).toEqual([]);
  });

  it.each([
    'staff_payroll_runs',
    'staff_payroll_lines',
    'staff_payroll_ledger_entries',
    'scholarship_disbursements',
    'scholarship_compliance_records',
    'hostel_fee_structures',
    'transport_fee_structures',
    'transport_fee_links',
    'fee_ledger_entries',
    'parent_fee_payments',
    'library_fines',
    'health_vaccinations',
  ])('retains statutory table %s', (table) => {
    expect(tenantWipeDisposition(table)?.action).toBe('retain');
  });

  it('preserves every audit table and all privacy evidence', () => {
    const auditLike = tenantTables.filter((t) => /(^audit|_audit$|_audits$)/.test(t));
    expect(auditLike.length).toBeGreaterThan(3);
    for (const t of [...auditLike, ...tenantTables.filter((x) => x.startsWith('privacy_'))]) {
      expect(['preserve', 'retain'], t).toContain(tenantWipeDisposition(t)?.action);
    }
  });

  // Conservative: every FK ever declared counts (later DROP/re-ADD history is not
  // reconciled), so a cascade that was once declared keeps its parent table.
  it('no kept table is cascade-deleted or nulled through a FK to a wiped table', () => {
    const kept = (t: string) => {
      const d = tenantWipeDisposition(t);
      return d !== undefined && d.action !== 'wipe';
    };
    const wiped = (t: string) => tenantWipeDisposition(t)?.action === 'wipe';
    const violations = catalogue.foreignKeys
      .filter(
        (fk) =>
          kept(fk.from) &&
          wiped(fk.to) &&
          fk.onDelete !== 'NO ACTION' &&
          fk.onDelete !== 'RESTRICT',
      )
      .map((fk) => `${fk.from} -> ${fk.to} ON DELETE ${fk.onDelete}`);
    expect(violations).toEqual([]);
  });
});

describe('subject erasure link registry vs migration catalogue (PRC-H077)', () => {
  it.each(['student', 'staff'] as SubjectKind[])(
    'classifies every %s-linked column in the catalogue',
    (kind) => {
      const classified = new Set(SUBJECT_LINK_REGISTRY[kind].map((l) => `${l.table}.${l.column}`));
      const linkColumns = SUBJECT_LINK_COLUMNS[kind];
      const found: string[] = [];
      for (const [table, cols] of catalogue.columns) {
        if (!cols.has('tenant_id')) continue;
        for (const c of linkColumns) if (cols.has(c)) found.push(`${table}.${c}`);
      }
      expect(found.length).toBeGreaterThan(5);
      expect(found.filter((f) => !classified.has(f)).sort()).toEqual([]);
    },
  );

  it('registry entries reference real columns', () => {
    for (const kind of ['student', 'staff'] as SubjectKind[]) {
      for (const l of SUBJECT_LINK_REGISTRY[kind]) {
        expect(catalogue.columns.get(l.table)?.has(l.column), `${l.table}.${l.column}`).toBe(true);
      }
    }
  });

  it('retained subject links match the wipe registry retention classes', () => {
    for (const kind of ['student', 'staff'] as SubjectKind[]) {
      for (const l of SUBJECT_LINK_REGISTRY[kind].filter((x) => x.handling === 'retained')) {
        expect(['retain', 'preserve'], l.table).toContain(tenantWipeDisposition(l.table)?.action);
      }
    }
  });

  it.each([
    'student_discipline_incidents',
    'student_consents',
    'admission_offers',
    'lms_submissions',
    'report_card_teacher_comments',
  ])('treats %s as unhandled child PII (residual when rows exist)', (table) => {
    const entry = SUBJECT_LINK_REGISTRY.student.find((l) => l.table === table);
    expect(entry?.handling).toBe('unhandled');
  });
});
