/**
 * Contract for the UAT EC2 environment (docs/testing/uat/UAT_ENVIRONMENT.md):
 * loopback-only ports in 29000-29099, limits on every service, Release
 * Dockerfiles, no :latest, proxy routing, realm rendering without dev users or
 * secrets, and the secret-handling rules of the ops scripts.
 *
 *   node --test tools/scripts/uatenv/uatenv-contract.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  UAT_REALM_ROLES,
  corsOrigins,
  hostOptions,
  renderNginxConf,
  renderRealm,
  webOwnedV1Routes,
} from './uatenv-render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const HERE = join(ROOT, 'tools/scripts/uatenv');
const readYaml = (rel) =>
  // Compose merge tags (!override / !reset) are not YAML core tags; the
  // contract only needs the values.
  parse(readFileSync(join(ROOT, rel), 'utf8').replace(/ !(override|reset)\b/g, ''));
const overlay = readYaml('infrastructure/uat-ec2/docker-compose.uatenv.yml');
const base = readYaml('docker-compose.yml');
const scripts = readdirSync(HERE).filter((f) => f.endsWith('.sh'));
const src = (f) => readFileSync(join(HERE, f), 'utf8');

/** Release Dockerfiles per service (tools/scripts/detect-affected-services.mjs docker-config). */
const RELEASE_DOCKERFILES = {
  'api-gateway': ['infrastructure/docker/Dockerfile.api-gateway', undefined],
  'etl-worker': ['infrastructure/docker/Dockerfile.etl-worker', undefined],
  'exam-document-worker': ['workers/exam-document/Dockerfile', undefined],
  web: ['infrastructure/docker/Dockerfile.web', undefined],
  'registration-portal': ['infrastructure/docker/Dockerfile.nextjs-app', 'registration-portal'],
  'public-website': ['infrastructure/docker/Dockerfile.nextjs-app', 'public-website'],
  'admin-console': ['infrastructure/docker/Dockerfile.nextjs-app', 'admin-console'],
  'developer-portal': ['infrastructure/docker/Dockerfile.nextjs-app', 'developer-portal'],
  'install-wizard': ['infrastructure/docker/Dockerfile.nextjs-app', 'install-wizard'],
};

test('overlay covers every base service plus the proxy', () => {
  const names = new Set(Object.keys(overlay.services));
  for (const svc of Object.keys(base.services)) assert.ok(names.has(svc), `overlay misses ${svc}`);
  assert.ok(names.has('proxy'));
});

test('every published port is loopback-bound inside 29000-29099', () => {
  for (const [name, svc] of Object.entries(overlay.services)) {
    for (const p of svc.ports ?? []) {
      const m =
        /^'?\$\{(UATENV_BIND|UATENV_PROXY_BIND):-127\.0\.0\.1\}:(\$\{UATENV_PROXY_PORT:-)?(\d+)\}?:\d+'?$/.exec(
          String(p),
        );
      assert.ok(m, `${name} port ${p} must be \${UATENV_BIND:-127.0.0.1}:<290xx>:<container>`);
      const host = Number(m[3]);
      assert.ok(host >= 29000 && host <= 29099, `${name} host port ${host} outside 29000-29099`);
    }
  }
  assert.deepEqual(overlay.services.redis.ports, []);
  assert.deepEqual(overlay.services.kafka.ports, []);
});

test('no 0.0.0.0 binding and no :latest image in the overlay', () => {
  const text = readFileSync(join(ROOT, 'infrastructure/uat-ec2/docker-compose.uatenv.yml'), 'utf8');
  assert.doesNotMatch(text.replace(/^\s*#.*$/gm, ''), /0\.0\.0\.0/);
  assert.doesNotMatch(text, /:latest\b/);
});

test('every service has CPU and memory limits and log rotation', () => {
  for (const [name, svc] of Object.entries(overlay.services)) {
    const limits = svc.deploy?.resources?.limits;
    assert.ok(limits?.cpus && limits?.memory, `${name} needs cpus + memory limits`);
    assert.equal(svc.logging?.driver, 'json-file', `${name} needs json-file logging`);
    assert.ok(svc.logging?.options?.['max-size'], `${name} needs log max-size`);
  }
});

test('app images come from the Release Dockerfiles, local tags, never pulled', () => {
  for (const [svc, [dockerfile, appName]] of Object.entries(RELEASE_DOCKERFILES)) {
    const s = overlay.services[svc];
    assert.equal(s.build?.dockerfile, dockerfile, `${svc} dockerfile`);
    assert.equal(s.build?.args?.APP_NAME, appName, `${svc} APP_NAME`);
    assert.equal(s.image, `proctira/${svc}:uatenv-\${UATENV_TAG:?Set UATENV_TAG}`);
    assert.equal(s.pull_policy, 'never');
  }
  for (const svc of ['public-website', 'admin-console', 'developer-portal', 'install-wizard']) {
    assert.deepEqual(overlay.services[svc].profiles, ['secondary'], `${svc} is secondary`);
  }
});

test('the registration portal calls the gateway on the compose network (UATENV-D27)', () => {
  // The portal forwards the tenant host as `Host`; via the proxy that host
  // routes back to the portal, so the shared public GATEWAY_URL must not reach it.
  assert.equal(
    overlay.services['registration-portal'].environment?.GATEWAY_URL,
    'http://api-gateway:3000',
  );
});

test('proxy image is digest-pinned through the env file and keycloak runs in production mode', () => {
  assert.match(overlay.services.proxy.image, /UATENV_PROXY_IMAGE:\?/);
  const secrets = readFileSync(join(HERE, 'uatenv-secrets.sh'), 'utf8');
  assert.match(secrets, /nginx-unprivileged:[\w.-]+@sha256:[0-9a-f]{64}/);
  assert.deepEqual(overlay.services.keycloak.command, ['start', '--import-realm']);
  assert.equal(overlay.services.keycloak.environment.KC_DB, 'postgres');
  assert.equal(overlay.services.keycloak.environment.KC_HEALTH_ENABLED, 'true');
});

test('nginx routing: web-owned /api/v1 routes go to web, the rest of /api/v1 to the gateway', () => {
  const opts = hostOptions({});
  const routes = webOwnedV1Routes(join(ROOT, 'apps/web'));
  assert.ok(routes.length > 0, 'expected web-owned /api/v1 routes');
  const conf = renderNginxConf(opts, routes);
  for (const r of routes) {
    assert.match(
      conf,
      new RegExp(`location = ${r.replace(/\//g, '\\/')} \\{[^}]*proxy_pass \\$up_web;`),
    );
  }
  assert.match(conf, /location \^~ \/api\/v1\/ \{[^}]*proxy_pass \$up_gateway;/);
  assert.match(conf, /listen 29080 default_server;[\s\S]*?return 421;/);
  assert.match(conf, /server_name api\.proctira-uat\.localhost;[\s\S]*?proxy_pass \$up_gateway;/);
  assert.match(conf, /server_name auth\.proctira-uat\.localhost;[\s\S]*?proxy_pass \$up_keycloak;/);
  assert.match(
    conf,
    /server_name e2e-registration\.proctira\.localhost;[\s\S]*?proxy_pass \$up_registration;/,
  );
  assert.ok(
    conf.includes('proxy_redirect ~^http://0\\.0\\.0\\.0:[0-9]+/(.*)$ $scheme://$http_host/$1;'),
    'bind-address redirects are mapped back to the public host',
  );
  assert.doesNotMatch(conf, /listen 29090 ssl/);
  assert.doesNotMatch(conf, /X-Forwarded-Proto \$http_x_forwarded_proto/);
});

test('nginx renders a TLS listener only in public TLS mode with a certificate', () => {
  const tls = { UATENV_TLS_CERT: '/x/cert.pem', UATENV_TLS_KEY: '/x/key.pem' };
  assert.match(
    renderNginxConf(hostOptions({ ...tls, UATENV_PUBLIC_TLS: '1' }), []),
    /listen 29090 ssl default_server;/,
  );
  // Certificate paths alone (public overlay not applied) must not render a
  // listener whose certificate is not mounted.
  assert.doesNotMatch(renderNginxConf(hostOptions(tls), []), /listen 29090/);
  assert.doesNotMatch(
    renderNginxConf(hostOptions({ ...tls, UATENV_PUBLIC_TLS: '0' }), []),
    /listen 29090/,
  );
});

test('the proxy overwrites X-Forwarded-For and is the only trusted proxy (SEM-6)', () => {
  const conf = renderNginxConf(hostOptions({}), []);
  assert.match(conf, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.doesNotMatch(conf, /\$proxy_add_x_forwarded_for/);
  assert.equal(
    overlay.services.proxy.networks.proctira.ipv4_address,
    '${UATENV_PROXY_IP:-172.29.90.250}',
  );
  const s = src('uatenv-secrets.sh');
  assert.match(s, /ensure "\$U" UATENV_PROXY_IP 172\.29\.90\.250/);
  assert.match(s, /ensure "\$U" TRUSTED_PROXY_CIDRS "\$\(get "\$U" UATENV_PROXY_IP\)\/32"/);
  assert.doesNotMatch(s, /ensure "\$U" TRUSTED_PROXY_CIDRS "\$\(get "\$U" UATENV_SUBNET\)"/);
});

test('Keycloak /admin and /realms/master are refused on the public listener only (SEM-7)', () => {
  const conf = renderNginxConf(
    hostOptions({ UATENV_PUBLIC_TLS: '1', UATENV_TLS_CERT: '/c', UATENV_TLS_KEY: '/k' }),
    [],
  );
  assert.match(conf, /map \$server_port \$uatenv_public_listener \{\s*29090\s+1;\s*default 0;/);
  const auth = conf.slice(conf.indexOf('server_name auth.proctira-uat.localhost;'));
  const authBlock = auth.slice(0, auth.indexOf('\nserver {'));
  for (const path of ['/admin', '/realms/master']) {
    assert.match(
      authBlock,
      new RegExp(
        `location \\^~ ${path.replace(/\//g, '\\/')} \\{\\s*if \\(\\$uatenv_public_listener\\) \\{\\s*return 403;`,
      ),
      `${path} must be refused on 29090`,
    );
  }
  assert.match(authBlock, /location \/ \{[^}]*proxy_pass \$up_keycloak;/);
});

test('public TLS mode is read from secrets/uatenv.env, not only the shell (SEM-8)', () => {
  const lib = src('uatenv-lib.sh');
  assert.match(lib, /env_file_get "\$UATENV_SEC\/uatenv\.env" UATENV_PUBLIC_TLS/);
  assert.match(src('uatenv-secrets.sh'), /ensure "\$U" UATENV_PUBLIC_TLS 0/);
});

test('every re-render is followed by a proxy recreate (SEM-1)', () => {
  const lib = src('uatenv-lib.sh');
  assert.match(
    lib,
    /uatenv_reload_proxy\(\) \{[^}]*uatenv_compose up -d --no-deps --force-recreate proxy/,
  );
  const redeploy = src('uatenv-redeploy.sh');
  const rollback = redeploy.slice(
    redeploy.indexOf('rollback() {'),
    redeploy.indexOf("trap 'rollback' EXIT"),
  );
  assert.match(
    rollback,
    /uatenv_render_configs "\$PREV_REL"[\s\S]*UATENV_RELEASE="\$PREV_REL" uatenv_reload_proxy/,
    'rollback must reload the proxy with the previous release config',
  );
  const main = redeploy.slice(redeploy.indexOf("trap 'rollback' EXIT"));
  assert.match(
    main,
    /up -d --remove-orphans[^\n]*proxy\nuatenv_reload_proxy\nwait_healthy/,
    'redeploy must reload the proxy before the health wait',
  );
  assert.match(src('uatenv-deploy.sh'), /up -d "\$\{APPS\[@\]\}" proxy\n\s*uatenv_reload_proxy\n/);
});

test('a failed reset reports the stopped apps and the recovery command (SEM-10)', () => {
  const reset = src('uatenv-reset-data.sh');
  const trapAt = reset.indexOf('trap on_exit EXIT');
  assert.ok(trapAt > 0, 'reset sets an EXIT trap');
  assert.ok(trapAt < reset.indexOf('uatenv_compose stop'), 'trap is set before the apps stop');
  assert.ok(
    trapAt > reset.indexOf('confirm_typed'),
    'an aborted confirmation prints no recovery hint',
  );
  assert.match(reset, /RESET FAILED[\s\S]*re-run: bash \$0/);
  assert.match(reset, /RESET_DONE=1\nuatenv_log "reset complete"/);
});

test('the backup waits for Postgres before dumping (boot catch-up, SEM-12)', () => {
  const backup = src('uatenv-backup.sh');
  assert.ok(
    backup.indexOf('pg_isready -q -h 127.0.0.1 -p 29010') < backup.indexOf('pg-backup.sh"'),
    'pg_isready wait precedes the dump',
  );
  const unit = readFileSync(
    join(ROOT, 'infrastructure/uat-ec2/systemd/proctira-uatenv-backup.service.in'),
    'utf8',
  );
  assert.doesNotMatch(
    unit,
    /^After=docker\.service/m,
    'user units cannot order after docker.service',
  );
});

test('CORS origins cover the tenant and platform hosts', () => {
  const origins = corsOrigins(hostOptions({}));
  assert.ok(origins.includes('http://sunrise-public-school.proctira.localhost:29080'));
  assert.ok(origins.includes('http://e2e-tenant-a.proctira.localhost:29080'));
  assert.ok(origins.includes('http://api.proctira-uat.localhost:29080'));
  assert.ok(!origins.some((o) => o.includes('*')));
});

test('rendered realm drops committed users and the dev secret, adds the UAT roles', () => {
  const realm = JSON.parse(readFileSync(join(ROOT, 'infra/keycloak/proctira-realm.json'), 'utf8'));
  const secret = 'a'.repeat(64);
  const out = renderRealm(realm, hostOptions({}), secret);
  assert.equal(out.users, undefined);
  assert.equal(out.bruteForceProtected, true);
  const client = out.clients.find((c) => c.clientId === 'proctira-gateway');
  assert.equal(client.secret, secret);
  assert.deepEqual(client.redirectUris, [
    'http://api.proctira-uat.localhost:29080/api/v1/auth/callback',
  ]);
  assert.ok(!client.webOrigins.includes('+'));
  const roles = out.roles.realm.map((r) => r.name);
  for (const r of UAT_REALM_ROLES) assert.ok(roles.includes(r), `missing role ${r}`);
  assert.doesNotMatch(JSON.stringify(out), /proctira-gateway-dev-secret|india-admin/);
  assert.throws(() => renderRealm(realm, hostOptions({}), 'proctira-gateway-dev-secret'));
  assert.throws(() => renderRealm(realm, hostOptions({}), ''));
});

test('ops scripts never enable xtrace', () => {
  for (const f of scripts) assert.doesNotMatch(src(f), /^\s*set -[a-z]*x/m, `${f} uses set -x`);
});

test('reset and teardown require a typed confirmation; teardown is never called by another script', () => {
  assert.match(src('uatenv-reset-data.sh'), /confirm_typed proctira-uatenv/);
  assert.match(src('uatenv-teardown.sh'), /confirm_typed proctira-uatenv/);
  assert.match(src('uatenv-teardown.sh'), /confirm_typed delete-volumes/);
  for (const f of scripts.filter((s) => s !== 'uatenv-teardown.sh')) {
    assert.doesNotMatch(src(f), /uatenv-teardown\.sh/, `${f} must not call teardown`);
  }
  for (const unit of ['proctira-uatenv-backup.service.in', 'proctira-uatenv-backup.timer.in']) {
    const text = readFileSync(join(ROOT, 'infrastructure/uat-ec2/systemd', unit), 'utf8');
    assert.doesNotMatch(text, /teardown|reset-data/);
  }
});

test('docker is only reached through uatenv_compose or for proctira-uatenv objects', () => {
  for (const f of scripts) {
    for (const line of src(f).split('\n')) {
      const code = line.replace(/#.*$/, '');
      // A docker command: at line start, after $( | && ; or xargs -r.
      if (!/(^|\$\(|\||&&|;|xargs -r)\s*docker\s+(?!compose\b)/.test(code)) continue;
      assert.match(
        code,
        /docker (inspect|ps|image ls|image rm|image inspect|build)\b|docker run --rm --name "\$UATENV_PROJECT-probe-|docker compose/,
        `${f}: unexpected docker call: ${line.trim()}`,
      );
    }
    assert.doesNotMatch(
      src(f),
      /docker (rm|stop|restart|kill|volume rm|network rm|system prune)\b/,
    );
  }
});

test('credential variables have no :- defaults in the ops scripts (PRC-L183)', () => {
  const credential = /\$\{[A-Z_]*(PASSWORD|SECRET|TOKEN|DATABASE_URL|REDIS_URL|RABBITMQ_URL):-/;
  for (const f of scripts) {
    const offenders = src(f)
      .split('\n')
      .filter((l) => credential.test(l));
    assert.deepEqual(offenders, [], `${f} has credential defaults`);
  }
});

test('secrets are generated, never echoed, and gateway.env holds no operator credential', () => {
  const s = src('uatenv-secrets.sh');
  assert.match(s, /openssl rand/);
  assert.doesNotMatch(s, /echo .*\$\(get /);
  const gatewayKeys = [...s.matchAll(/ensure "\$G" ([A-Z_]+)/g)].map((m) => m[1]);
  for (const k of [
    'BOOTSTRAP_DATABASE_URL',
    'MIGRATOR_DATABASE_URL',
    'BACKUP_DATABASE_URL',
    'MIGRATOR_PASSWORD',
    'POSTGRES_PASSWORD',
  ]) {
    assert.ok(!gatewayKeys.includes(k), `gateway.env must not carry ${k}`);
  }
});
