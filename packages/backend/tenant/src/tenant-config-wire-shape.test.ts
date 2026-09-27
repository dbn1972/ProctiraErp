/**
 * `tenants.config` has to be serializable by the schema that describes it.
 *
 * ## The defect
 *
 * `tenants.config` is unconstrained jsonb. `TenantConfigSchema` declares
 * `locale` as an object with three **required** fields; `db/seeds/002` stored it
 * as the bare string `"en-IN"` with a sibling `"timezone"`. Served through that
 * schema, the seeded row is not lossy — it is a hard failure:
 *
 *     500 Internal Server Error   "defaultLocale" is required!
 *
 * `fast-json-stringify` throws rather than emit a partial object.
 *
 * I had this recorded as "emits `{"config":{"locale":{}}}` rather than erroring",
 * which understated it. That `{}` came from a hand-written probe schema that
 * omitted the `required` array. Both readings are pinned below so the correction
 * cannot be lost again.
 *
 * ## Why nothing noticed, and what is actually at risk
 *
 * The two consumers disagree about tolerance. `resolveTenantTimezone`
 * (`packages/shared/tenant/src/tenant-timezone.ts`) reads flat `config.timezone`
 * as one of its candidates, so the timezone kept resolving. A schema-bearing
 * route would not tolerate it.
 *
 * But `routes.ts` — the file mounted at `/api/v1/tenant-lifecycle` — declares no
 * `schema:` block at all, so `config` is returned raw today and the flat shape
 * passes through unharmed. The 500 is what `TenantResponseSchema` is *for*:
 * attaching it to those routes is the obvious next step, and it would turn every
 * un-repaired row into a 500.
 *
 * ## Scope
 *
 * This change fixes the seed. It does **not** normalize on read: that would
 * change a live response body, and `updateTenant` persists what it read through
 * `mirrorToTenantRow`, so a name-only edit would write back a `supportedLocales`
 * nobody supplied — a read silently performing an unaudited migration. Repairing
 * existing rows belongs in a forward migration covering both `tenants.config`
 * and `control_plane_documents`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { TenantConfigSchema, TenantListResponseSchema, TenantResponseSchema } from './schemas.js';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** The seed under test, read once. */
const SEED_SQL = readFileSync(
  join(SRC_DIR, '../../../../db/seeds/002_multi_board_schools_500.sql'),
  'utf8',
);

/** Serve `payload` through a Fastify route carrying `responseSchema`. */
async function serve(
  responseSchema: unknown,
  payload: unknown,
): Promise<{ status: number; body: string }> {
  const app = Fastify();
  app.get('/t', { schema: { response: { 200: responseSchema } } }, async () => payload);
  try {
    const response = await app.inject({ method: 'GET', url: '/t' });
    return { status: response.statusCode, body: response.body };
  } finally {
    await app.close();
  }
}

/**
 * Serialize a bare `{ config }` through a schema describing only that field.
 * Isolates the config fragment from the rest of a tenant response.
 */
function serveConfig(
  config: unknown,
  configSchema: unknown = TenantConfigSchema,
): Promise<{ status: number; body: string }> {
  return serve({ type: 'object', properties: { config: configSchema } }, { config });
}

/** A complete tenant response, so the whole-response schemas are satisfiable. */
function tenantResponse(config: unknown): Record<string, unknown> {
  return {
    id: '00000000-0000-4000-8000-00000000ce27',
    name: 'Proctira Multi-Board Certification Tenant',
    slug: 'proctira-multiboard-cert',
    status: 'active',
    plan: null,
    region: null,
    config,
    suspendedAt: null,
    suspendedReason: null,
    decommissionedAt: null,
    dataRetentionUntil: null,
    legalHold: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** The legacy row `db/seeds/002` used to write, and that existing databases hold. */
const LEGACY_ROW = {
  locale: 'en-IN',
  timezone: 'Asia/Kolkata',
  certification: true,
};

/** The row `db/seeds/002` writes now. */
const SEEDED_ROW = {
  locale: {
    defaultLocale: 'en-IN',
    supportedLocales: ['en-IN'],
    timezone: 'Asia/Kolkata',
  },
  timezone: 'Asia/Kolkata',
  certification: true,
};

describe('the defect, stated as a test', () => {
  it('the legacy row is a 500 through TenantConfigSchema, not a partial object', async () => {
    const { status, body } = await serveConfig(LEGACY_ROW);
    expect(status).toBe(500);
    expect(body).toContain('defaultLocale');
  });

  it('is a 500 through the whole-response schemas a route would attach', async () => {
    // Not the fragment — the schemas themselves, with every other required field
    // supplied, so the only thing that can fail is `config`.
    const single = await serve(TenantResponseSchema, tenantResponse(LEGACY_ROW));
    expect(single.status, single.body).toBe(500);
    expect(single.body).toContain('defaultLocale');

    const list = await serve(TenantListResponseSchema, {
      data: [tenantResponse(LEGACY_ROW)],
      meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    });
    expect(list.status, list.body).toBe(500);
  });

  it('the retracted reading needs a schema with no `required`, which TypeBox never emits', async () => {
    // Pins the correction: drop `required` and you get the silent `{}` I first
    // reported. `Type.Object` with non-optional members always emits `required`,
    // so that reading never described this code.
    const noRequired = {
      type: 'object',
      properties: {
        locale: {
          type: 'object',
          properties: {
            defaultLocale: { type: 'string' },
            supportedLocales: { type: 'array', items: { type: 'string' } },
            timezone: { type: 'string' },
          },
        },
      },
    };
    const { status, body } = await serveConfig(LEGACY_ROW, noRequired);
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ config: { locale: {} } });

    expect(TenantConfigSchema.properties.locale).toHaveProperty('required');
  });
});

describe('the seeded row', () => {
  it('serializes cleanly through every tenant response schema', async () => {
    const fragment = await serveConfig(SEEDED_ROW);
    expect(fragment.status, fragment.body).toBe(200);

    const single = await serve(TenantResponseSchema, tenantResponse(SEEDED_ROW));
    expect(single.status, single.body).toBe(200);
    expect(JSON.parse(single.body).config.locale.defaultLocale).toBe('en-IN');

    const list = await serve(TenantListResponseSchema, {
      data: [tenantResponse(SEEDED_ROW)],
      meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    });
    expect(list.status, list.body).toBe(200);
  });

  it('reaches the client with its locale intact', async () => {
    const { body } = await serveConfig(SEEDED_ROW);
    expect(JSON.parse(body)).toEqual({
      config: {
        locale: {
          defaultLocale: 'en-IN',
          supportedLocales: ['en-IN'],
          timezone: 'Asia/Kolkata',
        },
      },
    });
  });

  it('keeps the flat timezone, which resolveTenantTimezone reads', () => {
    // Dropping it while "tidying up" would make a freshly-seeded database resolve
    // its timezone differently from one still holding the legacy row.
    expect(SEEDED_ROW.timezone).toBe('Asia/Kolkata');
    expect(SEEDED_ROW.locale.timezone).toBe(SEEDED_ROW.timezone);
  });

  it('is what the seed file actually contains', () => {
    // The assertions above are worth nothing if the SQL says something else.
    const match = SEED_SQL.match(/^\s*'(\{"locale".*\})'::jsonb,$/m);
    expect(match, 'tenant config literal not found in db/seeds/002').not.toBeNull();
    expect(JSON.parse(match![1])).toEqual(SEEDED_ROW);
  });

  it('the seed sets the timezone column, which outranks everything in config', () => {
    // `resolveTenantTimezone` ranks the `tenants.timezone` column first. The column
    // defaults to 'UTC' and this insert used to omit it, so an Indian multi-board
    // certification tenant resolved to UTC while its config claimed Asia/Kolkata —
    // every timestamp the certification suite produced was in the wrong zone.
    expect(SEED_SQL).toMatch(/INSERT INTO tenants \([^)]*\btimezone\b[^)]*\)/);
    expect(SEED_SQL).toContain("'Asia/Kolkata',");
  });

  it('the three timezone sources the seed writes all agree', () => {
    // Column, nested config, and flat config. Disagreement is silent: whichever
    // `resolveTenantTimezone` ranks highest wins and the others are dead weight.
    const match = SEED_SQL.match(/^\s*'(\{"locale".*\})'::jsonb,$/m);
    const config = JSON.parse(match![1]) as {
      timezone: string;
      locale: { timezone: string };
    };
    expect(config.locale.timezone).toBe('Asia/Kolkata');
    expect(config.timezone).toBe('Asia/Kolkata');
  });

  it('documents that its teardown cannot run twice once history exists', () => {
    // `enrollment_history` references `enrollments` but is append-only by trigger
    // (db/sql/080), so no delete order satisfies both. Verified by re-applying the
    // seed: `ERROR: enrollment_history is append-only (DELETE rejected)`. Pinned so
    // the limitation is not quietly "fixed" by loosening a W1-DATA-07 audit
    // invariant.
    expect(SEED_SQL).toContain('enrollment_history is append-only');
    expect(SEED_SQL).not.toMatch(/DELETE FROM enrollment_history/);
  });

  it('does not expose certification through a schema-bearing route', async () => {
    // Stored, not declared, therefore omitted. Recorded so nobody "fixes" the
    // omission by widening the schema — that would start emitting whatever else an
    // operator has put in an unconstrained jsonb column. Note this says nothing
    // about `routes.ts`, which has no schema and returns `config` raw.
    const { body } = await serveConfig(SEEDED_ROW);
    expect(JSON.parse(body).config).not.toHaveProperty('certification');
  });
});

describe('the premise that makes the 500 latent', () => {
  it('no tenant route attaches a response schema carrying config', () => {
    // The claim "latent, not live" rests entirely on this. Scans every source file
    // in the package rather than a hand-listed few: the first version of this test
    // listed four files and omitted `routes.ts`, the one that actually registers
    // the tenant routes, so attaching the schema there left it green.
    const sources = readdirSync(SRC_DIR).filter(
      (name) => name.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(name),
    );
    expect(sources).toContain('routes.ts');
    expect(sources.length).toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const name of sources) {
      // No try/catch: an unreadable file must fail the test, not be skipped.
      const text = readFileSync(join(SRC_DIR, name), 'utf8');
      if (/schema\s*:[\s\S]{0,400}?(TenantResponseSchema|TenantListResponseSchema)/.test(text)) {
        offenders.push(name);
      }
    }
    expect(
      offenders,
      'a route now serializes config through TenantConfigSchema — every row still holding the flat locale returns 500. Repair those rows before landing this.',
    ).toEqual([]);
  });

  it('routes.ts declares no response schema at all, so config is returned raw', () => {
    const routes = readFileSync(join(SRC_DIR, 'routes.ts'), 'utf8');
    expect(routes).toMatch(/fastify\.get\(/);
    expect(routes).not.toMatch(/\bschema\s*:/);
  });
});
