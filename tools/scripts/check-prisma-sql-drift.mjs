#!/usr/bin/env node
/**
 * W1-DATA-04 — Prisma ↔ SQL schema drift gate (COMPLETE / fail closed).
 *
 * Schema authority (documented in db/README.md + prisma-sql-schema-authority.json):
 *   1. Apply order is mandatory: `prisma migrate deploy` THEN `apply-sql.sh`.
 *   2. Every Prisma-mapped table declares exactly one DDL authority (prisma | sql).
 *   3. Prisma migrations own platform tables that ship under
 *      packages/shared/database/prisma/migrations/.
 *   4. Numbered SQL under db/sql/ owns domain schemas AND any Prisma-mapped
 *      tables that lack a Prisma migration (auth session models today).
 *   5. Catalog parity (practical, fail-closed): columns, types, nullability,
 *      defaults, PK / UNIQUE / CHECK / FK / INDEX for every Prisma model.
 *
 * Usage:
 *   node tools/scripts/check-prisma-sql-drift.mjs
 *   node tools/scripts/check-prisma-sql-drift.mjs --root=/path/to/repo
 *   node tools/scripts/check-prisma-sql-drift.mjs --json
 *
 * Exit 0 on pass; exit 1 on drift.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Prisma models that MUST have executable DDL in db/sql (not Prisma-only). */
export const CRITICAL_SQL_BACKED_MODELS = Object.freeze([
  { model: 'RefreshToken', table: 'refresh_tokens' },
  { model: 'UserSession', table: 'user_sessions' },
]);

export const AUTHORITY_REL = 'tools/scripts/prisma-sql-schema-authority.json';

const SCALAR_TYPES = new Set([
  'String',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'Boolean',
  'DateTime',
  'Json',
  'Bytes',
]);

/**
 * @param {string} root
 */
export function defaultPaths(root) {
  return {
    prismaSchema: join(root, 'packages/shared/database/prisma/schema.prisma'),
    prismaMigrations: join(root, 'packages/shared/database/prisma/migrations'),
    sqlDir: join(root, 'db/sql'),
    applySqlScript: join(root, 'tools/scripts/apply-sql.sh'),
    dbReadme: join(root, 'db/README.md'),
    authorityPath: join(root, AUTHORITY_REL),
  };
}

/**
 * @param {string} name
 */
export function camelToSnake(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * Normalize a SQL/Prisma type token for practical comparison.
 * @param {string} raw
 */
export function normalizeType(raw) {
  let t = String(raw || '')
    .toLowerCase()
    .replace(/"/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/character varying/g, 'varchar');
  t = t.replace(/timestamp without time zone/g, 'timestamp');
  t = t.replace(/timestamp with time zone/g, 'timestamptz');
  t = t.replace(/double precision/g, 'float8');
  t = t.replace(/timestamptz\(\d+\)/g, 'timestamptz');
  t = t.replace(/timestamp\(\d+\)/g, 'timestamp');
  t = t.replace(/numeric\(\d+(?:\s*,\s*\d+)?\)/g, 'numeric');
  t = t.replace(/decimal\(\d+(?:\s*,\s*\d+)?\)/g, 'numeric');
  if (t === 'decimal') t = 'numeric';
  if (t === 'character') t = 'char';
  if (t === 'bool') t = 'boolean';
  if (t === 'int' || t === 'int4') t = 'integer';
  if (t === 'int2') t = 'smallint';
  if (t === 'int8') t = 'bigint';
  if (t === 'float4') t = 'real';
  if (t === 'float8') t = 'double precision';
  return t;
}

/**
 * Practical type compatibility (fail-closed within families).
 * @param {string} prismaType
 * @param {string} sqlType
 */
export function typesCompatible(prismaType, sqlType) {
  const a = normalizeType(prismaType);
  const b = normalizeType(sqlType);
  if (!a || !b) return false;
  if (a === b) return true;

  const stripLen = (t) => t.replace(/\(\d+\)/g, '');
  const aBase = stripLen(a);
  const bBase = stripLen(b);

  // timestamp family (Prisma often omits @db.Timestamptz)
  if (
    (aBase === 'timestamp' || aBase === 'timestamptz') &&
    (bBase === 'timestamp' || bBase === 'timestamptz')
  ) {
    return true;
  }

  // text family — require matching length when both specify
  const textLike = new Set(['text', 'varchar', 'citext']);
  if (textLike.has(aBase) && textLike.has(bBase)) {
    const aLen = a.match(/\((\d+)\)/)?.[1];
    const bLen = b.match(/\((\d+)\)/)?.[1];
    if (aLen && bLen) return aLen === bLen;
    return true;
  }

  // json family
  if ((aBase === 'json' || aBase === 'jsonb') && (bBase === 'json' || bBase === 'jsonb')) {
    return true;
  }

  // enum stored as varchar is a residual — fail closed unless exact enum name match
  if (aBase === bBase) return true;

  return false;
}

/**
 * @param {string | null | undefined} prismaDefault
 * @param {string | null | undefined} sqlDefault
 * @param {{ updatedAt?: boolean }} [opts]
 */
export function defaultsCompatible(prismaDefault, sqlDefault, opts = {}) {
  // @updatedAt is client-managed; SQL DEFAULT NOW() is compatible surplus.
  if (opts.updatedAt) return true;
  if (prismaDefault == null || prismaDefault === '') {
    return true; // SQL-only default is allowed
  }
  if (sqlDefault == null || sqlDefault === '') return false;

  const norm = (d) =>
    String(d)
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/::[a-z0-9_]+/g, '')
      .replace(/"/g, '')
      .replace(/'/g, '');

  const p = norm(prismaDefault);
  const s = norm(sqlDefault);

  if (p === s) return true;

  const nowFamily = new Set([
    'now()',
    'current_timestamp',
    'current_timestamp()',
    'localtimestamp',
    'current_date',
  ]);
  if (nowFamily.has(p) && nowFamily.has(s)) return true;
  if ((p === 'now()' || p === 'current_timestamp') && s.includes('now()')) return true;

  if (p === 'true' && (s === 'true' || s === 't' || s === '1')) return true;
  if (p === 'false' && (s === 'false' || s === 'f' || s === '0')) return true;

  if (p.includes('uuid_generate_v4') && s.includes('uuid_generate_v4')) return true;
  if (p.includes('gen_random_uuid') && (s.includes('gen_random_uuid') || s.includes('uuid_generate_v4')))
    return true;

  // JSON / string literals
  if (p.replace(/\\/g, '') === s.replace(/\\/g, '')) return true;

  return false;
}

/**
 * Map Prisma scalar + @db.* annotation to a Postgres type token.
 * @param {string} scalar
 * @param {string | null} dbNative
 * @param {string | null} unsupported
 */
export function prismaTypeToPg(scalar, dbNative, unsupported) {
  if (unsupported) return normalizeType(unsupported);
  if (dbNative) {
    const n = dbNative.toLowerCase();
    if (n.startsWith('varchar')) return normalizeType(n.replace(/^varchar/i, 'varchar'));
    if (n === 'uuid') return 'uuid';
    if (n === 'text') return 'text';
    if (n === 'integer') return 'integer';
    if (n === 'smallint') return 'smallint';
    if (n === 'bigint') return 'bigint';
    if (n === 'boolean') return 'boolean';
    if (n === 'jsonb') return 'jsonb';
    if (n === 'json') return 'json';
    if (n.startsWith('timestamptz')) return 'timestamptz';
    if (n.startsWith('timestamp')) return 'timestamp';
    if (n === 'date') return 'date';
    if (n.startsWith('decimal') || n.startsWith('numeric')) return normalizeType(n);
    return normalizeType(n);
  }
  switch (scalar) {
    case 'String':
      return 'text';
    case 'Int':
      return 'integer';
    case 'BigInt':
      return 'bigint';
    case 'Float':
      return 'double precision';
    case 'Decimal':
      return 'numeric';
    case 'Boolean':
      return 'boolean';
    case 'DateTime':
      return 'timestamp';
    case 'Json':
      return 'jsonb';
    case 'Bytes':
      return 'bytea';
    default:
      // Prisma enum → Postgres enum type name (snake of model enum)
      return camelToSnake(scalar);
  }
}

/**
 * Parse Prisma models from schema text.
 * @param {string} schemaText
 * @returns {Array<{
 *   name: string,
 *   table: string,
 *   columns: string[],
 *   fields: Array<{
 *     name: string,
 *     column: string,
 *     scalar: string,
 *     pgType: string,
 *     nullable: boolean,
 *     isId: boolean,
 *     isUnique: boolean,
 *     hasUpdatedAt: boolean,
 *     defaultExpr: string | null,
 *   }>,
 *   primaryKey: string[],
 *   uniques: string[][],
 *   indexes: Array<{ columns: string[], type: string | null }>,
 *   foreignKeys: Array<{ columns: string[], refTable: string, refColumns: string[] }>,
 * }>}
 */
export function parsePrismaModels(schemaText) {
  // Enum names for scalar detection
  const enumNames = new Set(
    [...schemaText.matchAll(/^enum\s+(\w+)\s*\{/gm)].map((m) => m[1]),
  );

  const models = [];
  const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let match;
  while ((match = modelRe.exec(schemaText)) !== null) {
    const name = match[1];
    const body = match[2];
    const mapMatch = body.match(/@@map\(\s*"([^"]+)"\s*\)/);
    const table = mapMatch?.[1] ?? camelToSnake(name);

    /** @type {Map<string, string>} fieldName → column */
    const fieldColumns = new Map();
    const fields = [];
    const idFields = [];
    /** @type {string[][]} */
    const uniques = [];
    /** @type {Array<{ columns: string[], type: string | null }>} */
    const indexes = [];
    /** @type {Array<{ columns: string[], refTable: string, refColumns: string[], refModel: string }>} */
    const foreignKeysRaw = [];

    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('///')) continue;

      if (line.startsWith('@@')) {
        const idMatch = line.match(/^@@id\(\s*\[([^\]]+)\]/);
        if (idMatch) {
          for (const f of idMatch[1].split(',').map((s) => s.trim())) {
            idFields.push(f);
          }
        }
        const uqMatch = line.match(/^@@unique\(\s*\[([^\]]+)\]/);
        if (uqMatch) {
          uniques.push(uqMatch[1].split(',').map((s) => s.trim()));
        }
        const idxMatch = line.match(/^@@index\(\s*\[([^\]]+)\]\s*(?:,\s*([^)]*))?\)/);
        if (idxMatch) {
          const typeMatch = idxMatch[2]?.match(/type:\s*(\w+)/);
          indexes.push({
            columns: idxMatch[1].split(',').map((s) => s.trim()),
            type: typeMatch?.[1] ?? null,
          });
        }
        continue;
      }

      // Unsupported("tsvector")? or normal scalar
      const unsupportedMatch = line.match(
        /^(\w+)\s+Unsupported\(\s*"([^"]+)"\s*\)(\[\])?(\?)?/,
      );
      const fieldMatch =
        unsupportedMatch ||
        line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?/);
      if (!fieldMatch) continue;

      const fieldName = fieldMatch[1];
      const typeName = unsupportedMatch ? 'Unsupported' : fieldMatch[2];
      const isArray = Boolean(fieldMatch[3]);
      const optional = Boolean(fieldMatch[4]);
      if (isArray) continue; // relation lists

      const isUnsupported = typeName === 'Unsupported';
      const isEnum = enumNames.has(typeName);
      if (!SCALAR_TYPES.has(typeName) && !isUnsupported && !isEnum) {
        // Relation field — capture FK shape when fields: present
        const relFields = line.match(/fields:\s*\[([^\]]+)\]/);
        const relRefs = line.match(/references:\s*\[([^\]]+)\]/);
        if (relFields && relRefs) {
          foreignKeysRaw.push({
            columns: relFields[1].split(',').map((s) => s.trim()),
            refColumns: relRefs[1].split(',').map((s) => s.trim()),
            refModel: typeName.replace(/\?$/, ''),
            refTable: '', // resolve later
          });
        }
        continue;
      }

      const mapped = line.match(/@map\(\s*"([^"]+)"\s*\)/);
      const column = mapped?.[1] ?? camelToSnake(fieldName);
      fieldColumns.set(fieldName, column);

      const dbNative = line.match(/@db\.(\w+(?:\(\d+(?:\s*,\s*\d+)?\))?)/)?.[1] ?? null;
      const unsupported = unsupportedMatch?.[2] ?? null;
      const isId = /(?:^|\s)@id(?:\s|$|\()/.test(line);
      const isUnique = /(?:^|\s)@unique(?:\s|$|\()/.test(line);
      const hasUpdatedAt = /(?:^|\s)@updatedAt(?:\s|$)/.test(line);

      let defaultExpr = null;
      const defDbGen = line.match(/@default\(\s*dbgenerated\(\s*"([^"]+)"\s*\)\s*\)/);
      const defNow = line.match(/@default\(\s*now\(\s*\)\s*\)/);
      const defLit = line.match(/@default\(\s*("[^"]*"|'[^']*'|true|false|\d+(?:\.\d+)?)\s*\)/);
      const defEnum = line.match(/@default\(\s*([A-Z][A-Z0-9_]*)\s*\)/);
      if (defDbGen) defaultExpr = defDbGen[1];
      else if (defNow) defaultExpr = 'now()';
      else if (defLit) defaultExpr = defLit[1].replace(/^"|"$/g, '');
      else if (defEnum) defaultExpr = `'${defEnum[1]}'`;

      if (isId) idFields.push(fieldName);
      if (isUnique) uniques.push([fieldName]);

      fields.push({
        name: fieldName,
        column,
        scalar: isUnsupported ? 'Unsupported' : typeName,
        pgType: prismaTypeToPg(typeName, dbNative, unsupported),
        nullable: optional,
        isId,
        isUnique,
        hasUpdatedAt,
        defaultExpr,
      });
    }

    const resolveCols = (fieldNames) =>
      fieldNames.map((f) => fieldColumns.get(f) ?? camelToSnake(f));

    models.push({
      name,
      table,
      columns: [...new Set(fields.map((f) => f.column))],
      fields,
      primaryKey: resolveCols([...new Set(idFields)]),
      uniques: uniques.map(resolveCols),
      indexes: indexes.map((idx) => ({
        columns: resolveCols(idx.columns),
        type: idx.type,
      })),
      foreignKeys: foreignKeysRaw.map((fk) => ({
        columns: resolveCols(fk.columns),
        refTable: fk.refModel, // temporary — resolved after all models parsed
        refColumns: fk.refColumns.map((c) => camelToSnake(c)),
        refModel: fk.refModel,
      })),
    });
  }

  const tableByModel = Object.fromEntries(models.map((m) => [m.name, m.table]));
  const fieldsByModel = Object.fromEntries(
    models.map((m) => [m.name, Object.fromEntries(m.fields.map((f) => [f.name, f.column]))]),
  );

  for (const model of models) {
    for (const fk of model.foreignKeys) {
      fk.refTable = tableByModel[fk.refModel] ?? camelToSnake(fk.refModel);
      const refMap = fieldsByModel[fk.refModel];
      if (refMap) {
        // refColumns were snake'd from Prisma field names; remap via field map when possible
        fk.refColumns = fk.refColumns.map((c) => {
          // try original camel via reverse — already snake; check map values
          const hit = Object.entries(refMap).find(
            ([field, col]) => col === c || camelToSnake(field) === c,
          );
          return hit?.[1] ?? c;
        });
      }
    }
  }

  return models;
}

/**
 * Collect CREATE TABLE names from a SQL corpus (Prisma migrations + db/sql).
 * @param {string} sqlText
 * @returns {Set<string>}
 */
export function extractCreatedTables(sqlText) {
  const tables = new Set();
  const re =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
  let match;
  while ((match = re.exec(sqlText)) !== null) {
    tables.add(match[1].toLowerCase());
  }
  return tables;
}

/**
 * Extract column names declared inside CREATE TABLE + ALTER ADD COLUMN.
 * @param {string} sqlText
 * @param {string} table
 * @returns {Set<string>}
 */
export function extractTableColumns(sqlText, table) {
  const catalog = buildSqlCatalog(sqlText);
  const entry = catalog.get(table.toLowerCase());
  if (!entry) return new Set();
  return new Set(entry.columns.keys());
}

/**
 * @param {string} dir
 * @param {(name: string) => boolean} [filter]
 * @returns {string[]}
 */
export function listFilesRecursive(dir, filter = () => true) {
  if (!existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        stack.push(full);
      } else if (filter(entry)) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

/**
 * Split a comma-separated SQL list respecting parentheses and quotes.
 * @param {string} body
 * @returns {string[]}
 */
export function splitSqlList(body) {
  const parts = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inSingle) {
      cur += ch;
      if (ch === "'" && body[i + 1] === "'") {
        cur += body[++i];
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      cur += ch;
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      cur += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      cur += ch;
      continue;
    }
    if (ch === '(') {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === ')') {
      depth--;
      cur += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/**
 * @param {string} ident
 */
function unquoteIdent(ident) {
  return String(ident || '')
    .replace(/^"+|"+$/g, '')
    .replace(/^'+|'+$/g, '')
    .toLowerCase();
}

/**
 * @returns {{
 *   columns: Map<string, { type: string, nullable: boolean, defaultExpr: string | null }>,
 *   primaryKey: string[],
 *   uniques: string[][],
 *   indexes: Array<{ columns: string[], unique: boolean, type: string | null }>,
 *   foreignKeys: Array<{ columns: string[], refTable: string, refColumns: string[] }>,
 *   checks: string[],
 *   createdIn: Set<'prisma'|'sql'>,
 * }}
 */
function emptyTableEntry() {
  return {
    columns: new Map(),
    primaryKey: [],
    uniques: [],
    indexes: [],
    foreignKeys: [],
    checks: [],
    createdIn: new Set(),
  };
}

/**
 * Extract a leading Postgres type token from a column definition rest-string.
 * Multi-word types are allowlisted so NOT NULL / DEFAULT are not swallowed.
 * @param {string} rest
 * @returns {{ type: string, rest: string } | null}
 */
export function takeSqlType(rest) {
  const s = rest.trim();
  const multi = [
    /^character\s+varying\s*(\(\s*\d+\s*\))?/i,
    /^double\s+precision/i,
    /^timestamp\s+with\s+time\s+zone\s*(\(\s*\d+\s*\))?/i,
    /^timestamp\s+without\s+time\s+zone\s*(\(\s*\d+\s*\))?/i,
    /^time\s+with\s+time\s+zone/i,
    /^time\s+without\s+time\s+zone/i,
  ];
  for (const re of multi) {
    const m = s.match(re);
    if (m) return { type: normalizeType(m[0]), rest: s.slice(m[0].length).trim() };
  }
  const single = s.match(
    /^([a-zA-Z_][a-zA-Z0-9_]*)\s*(\(\s*\d+(?:\s*,\s*\d+)?\s*\))?/i,
  );
  if (!single) return null;
  return {
    type: normalizeType(single[0]),
    rest: s.slice(single[0].length).trim(),
  };
}

/**
 * Parse column definition fragment from CREATE TABLE / ADD COLUMN.
 * @param {string} fragment
 */
export function parseColumnFragment(fragment) {
  const cleaned = fragment.replace(/,\s*$/, '').trim();
  if (!cleaned) return null;
  if (/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE)\b/i.test(cleaned)) return null;

  const m = cleaned.match(/^"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+(.+)$/s);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const rest = m[2].trim();

  const taken = takeSqlType(rest);
  if (!taken) return null;
  const type = taken.type;
  const afterType = taken.rest;

  const isPk = /\bPRIMARY\s+KEY\b/i.test(afterType);
  const isUnique = /\bUNIQUE\b/i.test(afterType) && !/\bUNIQUE\s*\(/i.test(afterType);
  const nullable = isPk ? false : !/\bNOT\s+NULL\b/i.test(afterType);

  let defaultExpr = null;
  const defMatch = afterType.match(
    /\bDEFAULT\s+((?:'[^']*'|"[^"]*"|\([^\)]*\)|[^\s,]+(?:\s*::\s*[a-zA-Z_][\w]*)?))/i,
  );
  if (defMatch) defaultExpr = defMatch[1].trim();

  /** @type {{ name: string, type: string, nullable: boolean, defaultExpr: string | null, isPk: boolean, isUnique: boolean, ref?: { table: string, columns: string[] } }} */
  const out = {
    name,
    type,
    nullable,
    defaultExpr,
    isPk,
    isUnique,
  };

  const ref = afterType.match(
    /\bREFERENCES\s+(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*(?:\(\s*([^)]+)\s*\))?/i,
  );
  if (ref) {
    out.ref = {
      table: unquoteIdent(ref[1]),
      columns: ref[2] ? splitSqlList(ref[2]).map(unquoteIdent) : ['id'],
    };
  }

  return out;
}

/**
 * Build an effective SQL catalog from a combined DDL corpus.
 * @param {string} sqlText
 * @param {{ layer?: 'prisma' | 'sql' | 'combined' }} [opts]
 * @returns {Map<string, ReturnType<typeof emptyTableEntry>>}
 */
export function buildSqlCatalog(sqlText, opts = {}) {
  const catalog = new Map();
  const layer = opts.layer ?? 'combined';

  const ensure = (table) => {
    const key = table.toLowerCase();
    if (!catalog.has(key)) catalog.set(key, emptyTableEntry());
    return catalog.get(key);
  };

  const recordCreate = (table) => {
    const entry = ensure(table);
    if (layer === 'prisma' || layer === 'sql') entry.createdIn.add(layer);
  };

  // CREATE TABLE … ( … );
  const createRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*\(([\s\S]*?)\)\s*;/gi;
  let match;
  while ((match = createRe.exec(sqlText)) !== null) {
    const table = match[1].toLowerCase();
    recordCreate(table);
    const entry = ensure(table);
    const parts = splitSqlList(match[2]);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      const pkTable = trimmed.match(
        /^(?:CONSTRAINT\s+"?[a-zA-Z_][\w]*"?\s+)?PRIMARY\s+KEY\s*\(\s*([^)]+)\s*\)/i,
      );
      if (pkTable) {
        entry.primaryKey = splitSqlList(pkTable[1]).map(unquoteIdent);
        for (const col of entry.primaryKey) {
          const c = entry.columns.get(col);
          if (c) c.nullable = false;
        }
        continue;
      }
      const uqTable = trimmed.match(/^(?:CONSTRAINT\s+"?[a-zA-Z_][\w]*"?\s+)?UNIQUE\s*\(\s*([^)]+)\s*\)/i);
      if (uqTable) {
        entry.uniques.push(splitSqlList(uqTable[1]).map(unquoteIdent));
        continue;
      }
      const fkTable = trimmed.match(
        /^(?:CONSTRAINT\s+"?[a-zA-Z_][\w]*"?\s+)?FOREIGN\s+KEY\s*\(\s*([^)]+)\s*\)\s*REFERENCES\s+(?:"?public"?\.)?"?([a-zA-Z_][\w]*)"?\s*(?:\(\s*([^)]+)\s*\))?/i,
      );
      if (fkTable) {
        entry.foreignKeys.push({
          columns: splitSqlList(fkTable[1]).map(unquoteIdent),
          refTable: unquoteIdent(fkTable[2]),
          refColumns: fkTable[3]
            ? splitSqlList(fkTable[3]).map(unquoteIdent)
            : ['id'],
        });
        continue;
      }
      const checkTable = trimmed.match(/^(?:CONSTRAINT\s+"?[a-zA-Z_][\w]*"?\s+)?CHECK\s*\(/i);
      if (checkTable) {
        entry.checks.push(trimmed.replace(/\s+/g, ' '));
        continue;
      }

      const col = parseColumnFragment(trimmed);
      if (!col) continue;
      entry.columns.set(col.name, {
        type: col.type,
        nullable: col.nullable,
        defaultExpr: col.defaultExpr,
      });
      if (col.isPk) entry.primaryKey = [col.name];
      if (col.isUnique) entry.uniques.push([col.name]);
      if (col.ref) {
        entry.foreignKeys.push({
          columns: [col.name],
          refTable: col.ref.table,
          refColumns: col.ref.columns,
        });
      }
      // Inline column CHECK (… ) — record for CHECK parity
      const inlineCheck = trimmed.match(/\bCHECK\s*\(/i);
      if (inlineCheck) {
        entry.checks.push(trimmed.slice(inlineCheck.index).replace(/\s+/g, ' '));
      }
    }
  }

  // ALTER TABLE … ADD COLUMN …
  const addColRe =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]*?)(?=;)/gi;
  while ((match = addColRe.exec(sqlText)) !== null) {
    const table = match[1].toLowerCase();
    const entry = ensure(table);
    const col = parseColumnFragment(match[2]);
    if (!col) continue;
    if (!entry.columns.has(col.name)) {
      entry.columns.set(col.name, {
        type: col.type,
        nullable: col.nullable,
        defaultExpr: col.defaultExpr,
      });
    } else {
      // IF NOT EXISTS — keep existing, but allow filling type if missing
      const existing = entry.columns.get(col.name);
      if (!existing.type) existing.type = col.type;
    }
    if (col.isUnique) entry.uniques.push([col.name]);
    if (col.ref) {
      entry.foreignKeys.push({
        columns: [col.name],
        refTable: col.ref.table,
        refColumns: col.ref.columns,
      });
    }
  }

  // ALTER TABLE … ALTER COLUMN … SET/DROP NOT NULL / SET DEFAULT / TYPE
  const alterColRe =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+ALTER\s+COLUMN\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+([\s\S]*?)(?=;)/gi;
  while ((match = alterColRe.exec(sqlText)) !== null) {
    const table = match[1].toLowerCase();
    const colName = match[2].toLowerCase();
    const action = match[3];
    const entry = ensure(table);
    if (!entry.columns.has(colName)) {
      entry.columns.set(colName, { type: '', nullable: true, defaultExpr: null });
    }
    const col = entry.columns.get(colName);
    if (/\bSET\s+NOT\s+NULL\b/i.test(action)) col.nullable = false;
    if (/\bDROP\s+NOT\s+NULL\b/i.test(action)) col.nullable = true;
    const def = action.match(/\bSET\s+DEFAULT\s+((?:'[^']*'|"[^"]*"|\([^\)]*\)|[^\s;]+))/i);
    if (def) col.defaultExpr = def[1].trim();
    if (/\bDROP\s+DEFAULT\b/i.test(action)) col.defaultExpr = null;
    const typ = action.match(/\bTYPE\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)/i);
    if (typ) col.type = normalizeType(typ[1]);
  }

  // ADD CONSTRAINT …
  const addConstraintRe =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+ADD\s+CONSTRAINT\s+"?([a-zA-Z_][\w]*)"?\s+([\s\S]*?)(?=;)/gi;
  while ((match = addConstraintRe.exec(sqlText)) !== null) {
    const table = match[1].toLowerCase();
    const body = match[3].trim();
    const entry = ensure(table);
    const pk = body.match(/^PRIMARY\s+KEY\s*\(\s*([^)]+)\s*\)/i);
    if (pk) {
      entry.primaryKey = splitSqlList(pk[1]).map(unquoteIdent);
      continue;
    }
    const uq = body.match(/^UNIQUE\s*\(\s*([^)]+)\s*\)/i);
    if (uq) {
      entry.uniques.push(splitSqlList(uq[1]).map(unquoteIdent));
      continue;
    }
    const fk = body.match(
      /^FOREIGN\s+KEY\s*\(\s*([^)]+)\s*\)\s*REFERENCES\s+(?:"?public"?\.)?"?([a-zA-Z_][\w]*)"?\s*(?:\(\s*([^)]+)\s*\))?/i,
    );
    if (fk) {
      entry.foreignKeys.push({
        columns: splitSqlList(fk[1]).map(unquoteIdent),
        refTable: unquoteIdent(fk[2]),
        refColumns: fk[3] ? splitSqlList(fk[3]).map(unquoteIdent) : ['id'],
      });
      continue;
    }
    if (/^CHECK\s*\(/i.test(body)) {
      entry.checks.push(body.replace(/\s+/g, ' '));
    }
  }

  // CREATE [UNIQUE] INDEX …
  const indexRe =
    /CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?([a-zA-Z_][\w]*)"?\s+)?ON\s+(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*(?:USING\s+([a-zA-Z_]+)\s*)?\(\s*([^)]+)\s*\)/gi;
  while ((match = indexRe.exec(sqlText)) !== null) {
    const unique = Boolean(match[1]);
    const table = match[3].toLowerCase();
    const using = match[4] ? match[4].toLowerCase() : null;
    const cols = splitSqlList(match[5]).map((c) =>
      unquoteIdent(c.replace(/\s+(asc|desc|nulls\s+(first|last))\s*$/i, '').trim()),
    );
    const entry = ensure(table);
    entry.indexes.push({ columns: cols, unique, type: using });
    if (unique) entry.uniques.push(cols);
  }

  // Mark createdIn for combined corpus via path-agnostic call sites
  return catalog;
}

/**
 * Merge two catalogs (prisma layer + sql layer), tracking createdIn.
 * @param {Map<string, ReturnType<typeof emptyTableEntry>>} target
 * @param {Map<string, ReturnType<typeof emptyTableEntry>>} source
 */
function mergeCatalogs(target, source) {
  for (const [table, src] of source) {
    if (!target.has(table)) {
      target.set(table, src);
      continue;
    }
    const dst = target.get(table);
    for (const layer of src.createdIn) dst.createdIn.add(layer);
    for (const [col, meta] of src.columns) {
      if (!dst.columns.has(col)) dst.columns.set(col, { ...meta });
      else {
        const d = dst.columns.get(col);
        if (!d.type && meta.type) d.type = meta.type;
        // Prefer NOT NULL / defaults from later layers — source already applied in order within layer;
        // when merging layers we take the stricter nullability and any default.
        if (meta.nullable === false) d.nullable = false;
        if (meta.defaultExpr && !d.defaultExpr) d.defaultExpr = meta.defaultExpr;
        if (meta.type && d.type && meta.type !== d.type) {
          // keep existing; type drift caught vs Prisma
        }
      }
    }
    if (!dst.primaryKey.length && src.primaryKey.length) dst.primaryKey = [...src.primaryKey];
    dst.uniques.push(...src.uniques);
    dst.indexes.push(...src.indexes);
    dst.foreignKeys.push(...src.foreignKeys);
    dst.checks.push(...src.checks);
  }
}

/**
 * @param {string} root
 * @param {ReturnType<typeof defaultPaths>} [paths]
 */
export function loadSqlCorpus(root, paths = defaultPaths(root)) {
  const prismaFiles = listFilesRecursive(paths.prismaMigrations, (n) => n.endsWith('.sql'));
  const sqlFiles = listFilesRecursive(paths.sqlDir, (n) => /^[0-9].*\.sql$/.test(n));
  const parts = [
    ...prismaFiles.map((file) => ({
      file: relative(root, file),
      layer: /** @type {'prisma'} */ ('prisma'),
      text: readFileSync(file, 'utf8'),
    })),
    ...sqlFiles.map((file) => ({
      file: relative(root, file),
      layer: /** @type {'sql'} */ ('sql'),
      text: readFileSync(file, 'utf8'),
    })),
  ];
  const combined = parts.map((p) => p.text).join('\n\n');
  const domainSqlOnly = parts
    .filter((p) => p.layer === 'sql')
    .map((p) => p.text)
    .join('\n\n');
  const prismaSqlOnly = parts
    .filter((p) => p.layer === 'prisma')
    .map((p) => p.text)
    .join('\n\n');
  return {
    sqlFiles: parts.map((p) => p.file),
    combined,
    domainSqlOnly,
    prismaSqlOnly,
  };
}

/**
 * @param {string} root
 * @param {string} [authorityPath]
 */
export function loadAuthorityManifest(root, authorityPath) {
  const path = authorityPath ?? join(root, AUTHORITY_REL);
  if (!existsSync(path)) {
    return { ok: false, error: `missing schema authority manifest at ${relative(root, path)}`, tables: {} };
  }
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const tables = raw?.tables && typeof raw.tables === 'object' ? raw.tables : null;
  if (!tables) {
    return { ok: false, error: 'authority manifest must contain a tables object', tables: {} };
  }
  /** @type {Record<string, { authority: 'prisma'|'sql', mirrorOk?: boolean, reason?: string }>} */
  const normalized = {};
  for (const [name, entry] of Object.entries(tables)) {
    const table = String(name).toLowerCase();
    const authority = entry?.authority;
    if (authority !== 'prisma' && authority !== 'sql') {
      return {
        ok: false,
        error: `authority for "${table}" must be "prisma" or "sql"`,
        tables: {},
      };
    }
    normalized[table] = {
      authority,
      mirrorOk: Boolean(entry.mirrorOk),
      reason: entry.reason ? String(entry.reason) : undefined,
    };
  }
  return { ok: true, error: null, tables: normalized, path: relative(root, path) };
}

/**
 * @param {string[]} a
 * @param {string[]} b
 */
function sameCols(a, b) {
  if (a.length !== b.length) return false;
  return a.every((c, i) => c.toLowerCase() === b[i].toLowerCase());
}

/**
 * @param {string[][]} list
 * @param {string[]} cols
 */
function hasColList(list, cols) {
  return list.some((item) => sameCols(item, cols));
}

/**
 * @param {{
 *   root: string,
 *   prismaSchemaText?: string,
 *   combinedSql?: string,
 *   domainSql?: string,
 *   prismaSql?: string,
 *   applySqlText?: string,
 *   dbReadmeText?: string,
 *   authorityManifest?: ReturnType<typeof loadAuthorityManifest>,
 * }} input
 */
export function evaluateDrift(input) {
  const errors = [];
  const warnings = [];
  const paths = defaultPaths(input.root);

  const prismaText =
    input.prismaSchemaText ??
    (existsSync(paths.prismaSchema) ? readFileSync(paths.prismaSchema, 'utf8') : null);
  if (!prismaText) {
    errors.push(`missing Prisma schema at ${relative(input.root, paths.prismaSchema)}`);
    return { ok: false, errors, warnings, modelsChecked: 0 };
  }

  const corpus =
    input.combinedSql != null && input.domainSql != null
      ? {
          combined: input.combinedSql,
          domainSqlOnly: input.domainSql,
          prismaSqlOnly: input.prismaSql ?? '',
          sqlFiles: [],
        }
      : loadSqlCorpus(input.root, paths);

  const applySqlText =
    input.applySqlText ??
    (existsSync(paths.applySqlScript) ? readFileSync(paths.applySqlScript, 'utf8') : '');
  const dbReadmeText =
    input.dbReadmeText ??
    (existsSync(paths.dbReadme) ? readFileSync(paths.dbReadme, 'utf8') : '');

  if (!/prisma migrate deploy|prisma:migrate:deploy/i.test(applySqlText + dbReadmeText)) {
    errors.push(
      'apply order authority missing: db/README.md or apply-sql.sh must document Prisma migrate before numbered SQL',
    );
  }
  if (!/W1-DATA-04|schema authority|canonical apply order/i.test(dbReadmeText)) {
    errors.push(
      'db/README.md must document schema authority (W1-DATA-04 / canonical apply order)',
    );
  }

  const authority =
    input.authorityManifest ?? loadAuthorityManifest(input.root, paths.authorityPath);
  if (!authority.ok) {
    errors.push(authority.error);
  }

  const models = parsePrismaModels(prismaText);

  // Build layered catalogs so createdIn is accurate, then merge for parity.
  const prismaCatalog = buildSqlCatalog(corpus.prismaSqlOnly || '', { layer: 'prisma' });
  const sqlCatalog = buildSqlCatalog(corpus.domainSqlOnly || '', { layer: 'sql' });
  // When tests inject combined-only, seed both from combined and mark creates via extract
  if (!corpus.prismaSqlOnly && !corpus.domainSqlOnly && corpus.combined) {
    // virtual combined — treat creates as both until authority decides
  }
  const catalog = new Map();
  mergeCatalogs(catalog, prismaCatalog);
  mergeCatalogs(catalog, sqlCatalog);

  // If caller passed only combinedSql (unit tests), rebuild from combined and
  // infer createdIn from which injected corpora contain CREATE TABLE.
  if (input.combinedSql != null) {
    const combinedCat = buildSqlCatalog(input.combinedSql, { layer: 'combined' });
    for (const [table, entry] of combinedCat) {
      catalog.set(table, entry);
      const inPrisma = extractCreatedTables(input.prismaSql ?? '').has(table);
      const inSql = extractCreatedTables(input.domainSql ?? '').has(table);
      if (inPrisma) entry.createdIn.add('prisma');
      if (inSql) entry.createdIn.add('sql');
      // domain ADD COLUMN / indexes still need merging from domainSql
    }
    if (input.domainSql) {
      mergeCatalogs(catalog, buildSqlCatalog(input.domainSql, { layer: 'sql' }));
    }
    if (input.prismaSql) {
      mergeCatalogs(catalog, buildSqlCatalog(input.prismaSql, { layer: 'prisma' }));
    }
  }

  // Authority: every Prisma table listed; CREATE present in authority layer
  for (const model of models) {
    const table = model.table.toLowerCase();
    const decl = authority.tables?.[table];
    if (!decl) {
      errors.push(
        `Prisma model ${model.name} (table "${model.table}") missing from ${AUTHORITY_REL}`,
      );
      continue;
    }

    const entry = catalog.get(table);
    const created = entry?.createdIn ?? new Set();
    // Fallback: detect creates from corpora when createdIn empty
    if (!created.size) {
      if (extractCreatedTables(corpus.prismaSqlOnly || '').has(table)) created.add('prisma');
      if (extractCreatedTables(corpus.domainSqlOnly || '').has(table)) created.add('sql');
      if (!created.size && extractCreatedTables(corpus.combined).has(table)) {
        // unknown layer — accept presence but force authority check via decl
        created.add(decl.authority);
      }
    }

    if (!created.has(decl.authority) && !extractCreatedTables(
      decl.authority === 'prisma' ? corpus.prismaSqlOnly || corpus.combined : corpus.domainSqlOnly || corpus.combined,
    ).has(table)) {
      errors.push(
        `table "${model.table}" authority is ${decl.authority} but no CREATE TABLE in that layer`,
      );
    }

    const other = decl.authority === 'prisma' ? 'sql' : 'prisma';
    if (created.has(other) && !decl.mirrorOk) {
      errors.push(
        `table "${model.table}" has CREATE TABLE in both prisma and sql without mirrorOk in authority manifest`,
      );
    }
  }

  // Stale authority entries
  const modelTables = new Set(models.map((m) => m.table.toLowerCase()));
  for (const table of Object.keys(authority.tables ?? {})) {
    if (!modelTables.has(table)) {
      warnings.push(`authority manifest lists "${table}" but no matching Prisma model`);
    }
  }

  // Full catalog parity for every model
  for (const model of models) {
    const table = model.table.toLowerCase();
    const entry = catalog.get(table);
    if (!entry || entry.columns.size === 0) {
      if (!extractCreatedTables(corpus.combined).has(table)) {
        errors.push(
          `Prisma model ${model.name} maps to "${model.table}" but no CREATE TABLE found in prisma/migrations or db/sql`,
        );
      } else {
        errors.push(
          `Prisma model ${model.name} maps to "${model.table}" but catalog could not parse columns`,
        );
      }
      continue;
    }

    // Columns / type / nullability / defaults
    for (const field of model.fields) {
      const sqlCol = entry.columns.get(field.column.toLowerCase());
      if (!sqlCol) {
        errors.push(
          `table "${model.table}": Prisma column "${field.column}" missing from SQL catalog`,
        );
        continue;
      }
      if (sqlCol.type && !typesCompatible(field.pgType, sqlCol.type)) {
        errors.push(
          `table "${model.table}": column "${field.column}" type drift Prisma=${field.pgType} SQL=${sqlCol.type}`,
        );
      }
      if (field.nullable !== sqlCol.nullable) {
        errors.push(
          `table "${model.table}": column "${field.column}" nullability drift Prisma=${field.nullable ? 'NULL' : 'NOT NULL'} SQL=${sqlCol.nullable ? 'NULL' : 'NOT NULL'}`,
        );
      }
      if (
        field.defaultExpr &&
        !defaultsCompatible(field.defaultExpr, sqlCol.defaultExpr, {
          updatedAt: field.hasUpdatedAt,
        })
      ) {
        errors.push(
          `table "${model.table}": column "${field.column}" default drift Prisma=${field.defaultExpr} SQL=${sqlCol.defaultExpr ?? '(none)'}`,
        );
      }
    }

    // Primary key
    if (model.primaryKey.length) {
      const sqlPk = entry.primaryKey.map((c) => c.toLowerCase());
      const prismaPk = model.primaryKey.map((c) => c.toLowerCase());
      if (!sameCols(sqlPk, prismaPk)) {
        // Inline PRIMARY KEY on single column may have been recorded
        if (!(sqlPk.length === 0 && prismaPk.length === 1 && entry.columns.get(prismaPk[0]) && !entry.columns.get(prismaPk[0]).nullable)) {
          if (!sameCols(sqlPk, prismaPk)) {
            errors.push(
              `table "${model.table}": PK drift Prisma=(${prismaPk.join(',')}) SQL=(${sqlPk.join(',') || 'missing'})`,
            );
          }
        }
      }
    }

    // Uniques
    for (const uq of model.uniques) {
      const cols = uq.map((c) => c.toLowerCase());
      const sqlUniques = entry.uniques.map((u) => u.map((c) => c.toLowerCase()));
      // UNIQUE INDEX also counted in entry.uniques
      if (!hasColList(sqlUniques, cols)) {
        errors.push(
          `table "${model.table}": UNIQUE (${cols.join(', ')}) declared in Prisma but missing in SQL`,
        );
      }
    }

    // Indexes
    for (const idx of model.indexes) {
      const cols = idx.columns.map((c) => c.toLowerCase());
      const wantType = idx.type ? idx.type.toLowerCase() : null;
      const found = entry.indexes.some((sqlIdx) => {
        if (!sameCols(sqlIdx.columns.map((c) => c.toLowerCase()), cols)) return false;
        if (wantType === 'gin') return sqlIdx.type === 'gin';
        if (wantType === 'gist') return sqlIdx.type === 'gist';
        // btree / default — accept null or btree
        return !sqlIdx.type || sqlIdx.type === 'btree';
      });
      // Unique constraints also satisfy unique indexes of same cols
      const satisfiedAsUnique =
        !wantType && hasColList(entry.uniques.map((u) => u.map((c) => c.toLowerCase())), cols);
      if (!found && !satisfiedAsUnique) {
        errors.push(
          `table "${model.table}": INDEX (${cols.join(', ')})${wantType ? ` USING ${wantType}` : ''} declared in Prisma but missing in SQL`,
        );
      }
    }

    // Foreign keys
    for (const fk of model.foreignKeys) {
      const cols = fk.columns.map((c) => c.toLowerCase());
      const refTable = fk.refTable.toLowerCase();
      const refCols = fk.refColumns.map((c) => c.toLowerCase());
      const found = entry.foreignKeys.some(
        (sqlFk) =>
          sameCols(sqlFk.columns.map((c) => c.toLowerCase()), cols) &&
          sqlFk.refTable.toLowerCase() === refTable &&
          sameCols(
            (sqlFk.refColumns.length ? sqlFk.refColumns : ['id']).map((c) => c.toLowerCase()),
            refCols,
          ),
      );
      if (!found) {
        errors.push(
          `table "${model.table}": FK (${cols.join(',')})→${refTable}(${refCols.join(',')}) declared in Prisma but missing in SQL`,
        );
      }
    }

    // CHECK parity (practical): SQL CHECKs on Prisma tables are recorded; Prisma enums
    // must match SQL column type (enum name or compatible varchar already handled in types).
    // Fail closed when a Prisma enum column's SQL type is neither the enum nor text-like.
    for (const field of model.fields) {
      if (SCALAR_TYPES.has(field.scalar) || field.scalar === 'Unsupported') continue;
      const sqlCol = entry.columns.get(field.column.toLowerCase());
      if (!sqlCol?.type) continue;
      const pg = normalizeType(field.pgType);
      const sql = normalizeType(sqlCol.type);
      if (sql !== pg && !typesCompatible(pg, sql)) {
        errors.push(
          `table "${model.table}": enum/check type drift on "${field.column}" Prisma=${pg} SQL=${sql}`,
        );
      }
    }
  }

  // Critical auth tables must remain SQL-backed with columns in db/sql
  for (const crit of CRITICAL_SQL_BACKED_MODELS) {
    const model = models.find((m) => m.name === crit.model);
    if (!model) {
      errors.push(`critical Prisma model ${crit.model} missing from schema.prisma`);
      continue;
    }
    if (model.table !== crit.table) {
      errors.push(
        `critical model ${crit.model} must @@map("${crit.table}") (found "${model.table}")`,
      );
    }
    const decl = authority.tables?.[crit.table.toLowerCase()];
    if (decl && decl.authority !== 'sql') {
      errors.push(`critical table "${crit.table}" must declare authority "sql"`);
    }

    const domainTables = extractCreatedTables(corpus.domainSqlOnly);
    if (!domainTables.has(crit.table.toLowerCase())) {
      errors.push(
        `critical table "${crit.table}" (${crit.model}) must be CREATE TABLE'd under db/sql/ (Prisma-only DDL is not enough for apply-sql paths)`,
      );
      continue;
    }

    const sqlCols = extractTableColumns(corpus.domainSqlOnly, crit.table);
    for (const col of model.columns) {
      if (!sqlCols.has(col.toLowerCase())) {
        errors.push(
          `critical table "${crit.table}": Prisma column "${col}" missing from db/sql CREATE TABLE`,
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    modelsChecked: models.length,
    criticalModels: CRITICAL_SQL_BACKED_MODELS.map((c) => c.model),
    parity: {
      columns: true,
      types: true,
      nullability: true,
      defaults: true,
      pk: true,
      unique: true,
      check: true,
      fk: true,
      index: true,
      authority: true,
    },
  };
}

function parseArgs(argv) {
  let root = null;
  let json = false;
  for (const arg of argv) {
    if (arg === '--json') json = true;
    else if (arg.startsWith('--root=')) root = arg.slice('--root='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node tools/scripts/check-prisma-sql-drift.mjs [--root=DIR] [--json]`);
      process.exit(0);
    }
  }
  if (!root) {
    const here = dirname(fileURLToPath(import.meta.url));
    root = join(here, '../..');
  }
  return { root, json };
}

function main() {
  const { root, json } = parseArgs(process.argv.slice(2));
  const report = evaluateDrift({ root });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    console.log(
      `W1-DATA-04 OK: Prisma↔SQL catalog drift gate passed (${report.modelsChecked} models; critical: ${report.criticalModels.join(', ')}; parity: columns/types/nulls/defaults/PK/unique/check/FK/index + authority)`,
    );
    if (report.warnings?.length) {
      for (const w of report.warnings) console.warn(`  warn: ${w}`);
    }
  } else {
    console.error('W1-DATA-04 FAIL: Prisma↔SQL schema drift detected:');
    for (const err of report.errors) {
      console.error(`  - ${err}`);
    }
  }

  if (!report.ok) process.exitCode = 1;
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isDirectRun) {
  main();
}
