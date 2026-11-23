/**
 * PRC-L169 — custom-domain ownership verification.
 *
 * Base: domains are added `verified: false` and there is no verify flow, so a custom domain can
 * never resolve. These tests prove the verify flow, the cross-tenant exclusivity, expiry and
 * re-checks, the HTTPS proof rules, and the re-check tick lock.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createDomainProofChecker,
  DOMAIN_VERIFICATION_TTL_MS,
  runDomainRecheckTick,
  type DomainProofChecker,
} from './custom-domain-verification.js';
import { InMemoryTenantRepository } from './in-memory-repository.js';
import { createPublicTenantResolver } from './public-tenant-resolver.js';
import { tenantLifecyclePlugin } from './tenant-plugin.js';
import type { TenantEntity } from './tenant-repository.js';
import { TenantService } from './tenant-service.js';

const BASE = 'apply.example.edu';
const HOST = 'admissions.north.example';

function tenantRow(id: string, slug: string): Omit<TenantEntity, 'createdAt' | 'updatedAt'> {
  return {
    id,
    name: slug,
    slug,
    status: 'active',
    plan: null,
    region: null,
    config: {} as TenantEntity['config'],
    suspendedAt: null,
    suspendedReason: null,
    decommissionedAt: null,
    dataRetentionUntil: null,
    legalHold: false,
  };
}

/** DNS TXT table: record name -> values. */
function txtChecker(records: Map<string, string>): DomainProofChecker {
  return createDomainProofChecker({
    resolveTxt: async (name) => {
      const value = records.get(name);
      if (value === undefined) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
      return [[value]];
    },
    // HTTPS proof never reachable in these cases.
    fetchDeps: {
      resolveHost: async () => {
        throw new Error('ENOTFOUND');
      },
    },
  });
}

describe('PRC-L169: verify flow over the mounted tenant routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryTenantRepository;
  let txt: Map<string, string>;
  let tenantA: string;
  let tenantB: string;

  beforeEach(async () => {
    repository = new InMemoryTenantRepository();
    txt = new Map();
    tenantA = randomUUID();
    tenantB = randomUUID();
    await repository.createTenant(tenantRow(tenantA, 'north'));
    await repository.createTenant(tenantRow(tenantB, 'south'));
    app = Fastify();
    await app.register(tenantLifecyclePlugin, {
      repository,
      branding: { disabled: true },
      domainVerification: { checker: txtChecker(txt), disableRecheck: true },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  async function addDomain(tenantId: string, domain = HOST) {
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${tenantId}/domains`,
      payload: { domain },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as {
      id: string;
      verified: boolean;
      verification: { token: string; dnsTxtName: string; httpsUrl: string };
    };
  }

  const verify = (tenantId: string, domainId: string) =>
    app.inject({ method: 'POST', url: `/tenants/${tenantId}/domains/${domainId}/verify` });

  it('issues a 256-bit challenge and resolves the host after the correct DNS TXT proof', async () => {
    const domain = await addDomain(tenantA);
    expect(domain.verified).toBe(false);
    expect(Buffer.from(domain.verification.token, 'base64url')).toHaveLength(32);
    expect(domain.verification.dnsTxtName).toBe(`_proctira-verify.${HOST}`);
    const resolver = createPublicTenantResolver({ repository, baseDomain: BASE });
    await expect(resolver.resolveHostname(HOST)).resolves.toBeNull();

    txt.set(domain.verification.dnsTxtName, domain.verification.token);
    const res = await verify(tenantA, domain.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ verified: true });
    expect(res.json().verification).toBeUndefined();
    await expect(resolver.resolveHostname(HOST)).resolves.toBe(tenantA);
  });

  it('a wrong or absent token leaves the domain unverified and unresolvable (422)', async () => {
    const domain = await addDomain(tenantA);
    const resolver = createPublicTenantResolver({ repository, baseDomain: BASE });
    expect((await verify(tenantA, domain.id)).statusCode).toBe(422);
    txt.set(domain.verification.dnsTxtName, 'not-the-token');
    expect((await verify(tenantA, domain.id)).statusCode).toBe(422);
    await expect(resolver.resolveHostname(HOST)).resolves.toBeNull();
    const list = await app.inject({ method: 'GET', url: `/tenants/${tenantA}/domains` });
    expect(list.json()[0].verified).toBe(false);
  });

  it('a hostname verified for tenant A cannot be verified for tenant B (409) and never resolves to B', async () => {
    const a = await addDomain(tenantA);
    txt.set(a.verification.dnsTxtName, a.verification.token);
    expect((await verify(tenantA, a.id)).statusCode).toBe(200);
    // B's row as created by a concurrent add (addDomain's global name check raced).
    const bId = randomUUID();
    await repository.addDomain({
      id: bId,
      tenantId: tenantB,
      domain: HOST,
      primary: false,
      verified: false,
      createdAt: new Date(),
      verificationToken: 'b-token',
    });
    txt.set(a.verification.dnsTxtName, 'b-token'); // B even controls DNS now
    const res = await verify(tenantB, bId);
    expect(res.statusCode).toBe(409);
    const resolver = createPublicTenantResolver({ repository, baseDomain: BASE });
    await expect(resolver.resolveHostname(HOST)).resolves.toBe(tenantA);
  });

  it('two unverified rows created concurrently and verified concurrently: exactly one wins', async () => {
    const aId = randomUUID();
    const bId = randomUUID();
    for (const [id, tenantId] of [
      [aId, tenantA],
      [bId, tenantB],
    ] as const) {
      await repository.addDomain({
        id,
        tenantId,
        domain: HOST,
        primary: false,
        verified: false,
        createdAt: new Date(),
        verificationToken: 'shared-token',
      });
    }
    txt.set(`_proctira-verify.${HOST}`, 'shared-token');
    const [ra, rb] = await Promise.all([verify(tenantA, aId), verify(tenantB, bId)]);
    expect([ra.statusCode, rb.statusCode].sort()).toEqual([200, 409]);
    const resolver = createPublicTenantResolver({ repository, baseDomain: BASE });
    const winner = ra.statusCode === 200 ? tenantA : tenantB;
    await expect(resolver.resolveHostname(HOST)).resolves.toBe(winner);
  });

  it('a verify call whose :id does not own :domainId -> 404 and nothing changes', async () => {
    const a = await addDomain(tenantA);
    txt.set(a.verification.dnsTxtName, a.verification.token);
    expect((await verify(tenantB, a.id)).statusCode).toBe(404);
    const resolver = createPublicTenantResolver({ repository, baseDomain: BASE });
    await expect(resolver.resolveHostname(HOST)).resolves.toBeNull();
  });

  it('the resolver fails closed when more than one row holds the hostname verified', async () => {
    const until = new Date(Date.now() + DOMAIN_VERIFICATION_TTL_MS);
    for (const tenantId of [tenantA, tenantB]) {
      await repository.addDomain({
        id: randomUUID(),
        tenantId,
        domain: HOST,
        primary: false,
        verified: true,
        verifiedAt: new Date(),
        verificationExpiresAt: until,
        createdAt: new Date(),
      });
    }
    const resolver = createPublicTenantResolver({ repository, baseDomain: BASE });
    await expect(resolver.resolveHostname(HOST)).resolves.toBeNull();
  });
});

describe('PRC-L169: expiry and re-checks', () => {
  it('an expired verification stops resolving; a failed re-check unverifies and invalidates the cache', async () => {
    const repository = new InMemoryTenantRepository();
    const tenantId = randomUUID();
    await repository.createTenant(tenantRow(tenantId, 'north'));
    let clock = Date.now();
    let dnsOk = true;
    let token = '';
    const checker: DomainProofChecker = { check: async (_d, t) => dnsOk && t === token };
    const service = new TenantService(repository, undefined, undefined, undefined, {
      domainProofChecker: checker,
      now: () => new Date(clock),
    });
    const added = await service.addDomain(tenantId, { domain: HOST });
    token = added.verificationToken!;
    await service.verifyDomain(tenantId, added.id);

    const resolver = createPublicTenantResolver({
      repository,
      baseDomain: BASE,
      now: () => clock,
    });
    await expect(resolver.resolveHostname(HOST)).resolves.toBe(tenantId);

    // 1) Expiry: the cached entry never outlives the verification.
    clock += DOMAIN_VERIFICATION_TTL_MS + 1;
    await expect(resolver.resolveHostname(HOST)).resolves.toBeNull();

    // 2) Re-verify, then a re-check 8 days later that passes extends the expiry.
    await service.verifyDomain(tenantId, added.id);
    await expect(resolver.resolveHostname(HOST)).resolves.toBe(tenantId);
    clock += 8 * 24 * 3600 * 1000;
    const passed = await runDomainRecheckTick({ repository, checker, now: () => new Date(clock) });
    expect(passed).toMatchObject({ ran: true, checked: 1, passed: 1 });
    const extended = (await repository.findDomainsByTenant(tenantId))[0]!;
    expect(new Date(extended.verificationExpiresAt!).getTime()).toBe(
      clock + DOMAIN_VERIFICATION_TTL_MS,
    );

    // 3) A failing re-check unverifies and the warm cache is invalidated at once.
    await expect(resolver.resolveHostname(HOST)).resolves.toBe(tenantId);
    clock += 8 * 24 * 3600 * 1000;
    dnsOk = false;
    const failed = await runDomainRecheckTick({ repository, checker, now: () => new Date(clock) });
    expect(failed).toMatchObject({ ran: true, checked: 1, failed: 1 });
    expect((await repository.findDomainsByTenant(tenantId))[0]!.verified).toBe(false);
    await expect(resolver.resolveHostname(HOST)).resolves.toBeNull();
  });

  it('two re-check ticks started concurrently: exactly one runs the checks', async () => {
    const repository = new InMemoryTenantRepository();
    const tenantId = randomUUID();
    await repository.createTenant(tenantRow(tenantId, 'north'));
    const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    await repository.addDomain({
      id: randomUUID(),
      tenantId,
      domain: HOST,
      primary: false,
      verified: true,
      verifiedAt: old,
      verificationExpiresAt: new Date(Date.now() + 1000 * 3600),
      verificationToken: 't',
      createdAt: old,
    });
    let checks = 0;
    const checker: DomainProofChecker = {
      check: async () => {
        checks += 1;
        return true;
      },
    };
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const first = runDomainRecheckTick({ repository, checker, onLocked: () => held });
    const second = await runDomainRecheckTick({ repository, checker });
    release();
    const firstResult = await first;
    expect(second.ran).toBe(false);
    expect(firstResult).toMatchObject({ ran: true, checked: 1 });
    expect(checks).toBe(1);
  });
});

describe('PRC-L169: HTTPS well-known proof (real local HTTP server, redirects disabled)', () => {
  // Generated per run: same base64url charset as the real 256-bit challenge.
  const TOKEN = randomBytes(32).toString('base64url');
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = req.url ?? '';
      const mode = req.headers['x-mode'];
      if (!path.startsWith('/.well-known/proctira-verify/')) {
        res.statusCode = 404;
        res.end('nope');
        return;
      }
      switch (mode) {
        case 'ok':
          res.end(`${TOKEN}\n`);
          return;
        case 'redirect301':
        case 'redirect302':
          res.statusCode = mode === 'redirect301' ? 301 : 302;
          res.setHeader('location', '/token-page');
          res.end();
          return;
        case 'big':
          res.end(`${TOKEN}${' '.repeat(2048)}`);
          return;
        case 'extra':
          res.end(`${TOKEN} and more`);
          return;
        default:
          res.statusCode = 404;
          res.end(TOKEN);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** safe-fetch validates https + public DNS; the transport is redirected to the local server. */
  function checkerFor(mode: string): DomainProofChecker {
    return createDomainProofChecker({
      resolveTxt: async () => {
        throw new Error('ENOTFOUND');
      },
      fetchDeps: {
        resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
        fetchImpl: (input, init) => {
          const url = new URL(String(input));
          return fetch(`http://127.0.0.1:${port}${url.pathname}`, {
            ...init,
            headers: { ...(init?.headers as Record<string, string>), 'x-mode': mode },
          });
        },
      },
    });
  }

  it('200 with body "<token>\\n" passes', async () => {
    await expect(checkerFor('ok').check(HOST, TOKEN)).resolves.toBe(true);
  });

  it.each([
    ['a 301 redirect to a page serving the token', 'redirect301'],
    ['a 302 redirect to a page serving the token', 'redirect302'],
    ['a 200 whose body exceeds 1 KiB', 'big'],
    ['a 200 with extra text', 'extra'],
    ['a 404', 'missing'],
  ])('%s fails', async (_label, mode) => {
    await expect(checkerFor(mode).check(HOST, TOKEN)).resolves.toBe(false);
  });

  it('a private / metadata address is never fetched (SSRF policy)', async () => {
    let fetched = false;
    const checker = createDomainProofChecker({
      resolveTxt: async () => {
        throw new Error('ENOTFOUND');
      },
      fetchDeps: {
        resolveHost: async () => [{ address: '169.254.169.254', family: 4 }],
        fetchImpl: async () => {
          fetched = true;
          return new Response(TOKEN);
        },
      },
    });
    await expect(checker.check(HOST, TOKEN)).resolves.toBe(false);
    expect(fetched).toBe(false);
  });
});
