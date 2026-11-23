#!/usr/bin/env node
/**
 * UAT EC2 environment renderer (docs/testing/uat/UAT_ENVIRONMENT.md).
 *
 * Pure functions (unit-tested in uatenv-contract.test.mjs):
 *   - renderNginxConf(opts)        reverse-proxy config for the `proxy` service
 *   - renderRealm(realmJson, opts) Keycloak realm import for the UAT host
 *   - webOwnedV1Routes(webAppDir)  /api/v1 route handlers served by apps/web
 *
 * CLI (no secret is ever written to stdout):
 *   node uatenv-render.mjs nginx --release <dir> --out <file>
 *   node uatenv-render.mjs realm --release <dir> --out <file>
 *     (reads KEYCLOAK_CLIENT_SECRET from the environment)
 *   node uatenv-render.mjs cors
 *
 * Host names come from UATENV_TENANT_BASE_DOMAIN, UATENV_PLATFORM_DOMAIN,
 * UATENV_PUBLIC_SCHEME, UATENV_PUBLIC_PORT and UATENV_TENANT_SLUGS, so public
 * exposure is a configuration change (see the doc's "Public exposure"). The TLS
 * listener needs UATENV_PUBLIC_TLS=1 plus UATENV_TLS_CERT / UATENV_TLS_KEY.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Realm roles the UAT role users need (gateway + web role catalogue ids). */
export const UAT_REALM_ROLES = Object.freeze([
  'super-admin',
  'admin',
  'principal',
  'teacher',
  'staff',
  'guardian',
  'bursar',
  'registrar',
  'warden',
  'transport_officer',
  'nurse',
  'librarian',
  'student',
]);

/** Client secrets committed for local development; never rendered. */
const DEV_CLIENT_SECRETS = new Set(['proctira-gateway-dev-secret']);

export function hostOptions(env = process.env) {
  const tenantBase = env.UATENV_TENANT_BASE_DOMAIN || 'proctira.localhost';
  const platform = env.UATENV_PLATFORM_DOMAIN || 'proctira-uat.localhost';
  const scheme = env.UATENV_PUBLIC_SCHEME || 'http';
  const port = String(env.UATENV_PUBLIC_PORT || '29080');
  const slugs = (env.UATENV_TENANT_SLUGS || 'sunrise-public-school,e2e-tenant-a')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const registrationSlugs = (env.UATENV_REGISTRATION_SLUGS ?? 'e2e-registration')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const defaultPort =
    (scheme === 'https' && port === '443') || (scheme === 'http' && port === '80');
  const publicTls = env.UATENV_PUBLIC_TLS === '1';
  const origin = (host) => `${scheme}://${host}${defaultPort ? '' : `:${port}`}`;
  return {
    tenantBase,
    platform,
    scheme,
    port,
    slugs,
    registrationSlugs,
    origin,
    apiHost: `api.${platform}`,
    authHost: `auth.${platform}`,
    registerHost: `register.${platform}`,
    adminHost: `admin.${platform}`,
    wwwHost: `www.${platform}`,
    developersHost: `developers.${platform}`,
    // The 29090 TLS listener is rendered only when the public overlay that
    // mounts the certificate is active too (uatenv_compose reads the same
    // UATENV_PUBLIC_TLS from secrets/uatenv.env).
    tlsCert: publicTls && env.UATENV_TLS_CERT ? '/etc/nginx/tls/fullchain.pem' : '',
    tlsKey: publicTls && env.UATENV_TLS_KEY ? '/etc/nginx/tls/privkey.pem' : '',
  };
}

/** Every browser origin the gateway must allow (CORS_ORIGINS). */
export function corsOrigins(opts) {
  const hosts = [
    ...opts.slugs.map((s) => `${s}.${opts.tenantBase}`),
    ...opts.registrationSlugs.map((s) => `${s}.${opts.tenantBase}`),
    opts.apiHost,
    opts.registerHost,
    opts.adminHost,
    opts.wwwHost,
    opts.developersHost,
  ];
  const list = hosts.map((h) => opts.origin(h));
  if (opts.scheme === 'http') list.push(`http://localhost:${opts.port}`);
  return list;
}

/** Route handlers under apps/web/src/app/api/v1 (served by web, not the gateway). */
export function webOwnedV1Routes(webAppDir) {
  const root = join(webAppDir, 'src', 'app', 'api', 'v1');
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/^route\.(ts|tsx|js|mjs)$/.test(name)) {
        const rel = relative(root, dirname(full)).split(sep).join('/');
        if (/\[/.test(rel)) {
          throw new Error(`dynamic web /api/v1 route needs a regex location: ${rel}`);
        }
        out.push(`/api/v1/${rel}`);
      }
    }
  };
  walk(root);
  return out.sort();
}

const proxyCommon = `
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        # The proxy is the edge: overwrite any client-supplied X-Forwarded-For so
        # the gateway (TRUSTED_PROXY_CIDRS = this proxy's pinned IP only) never
        # takes a spoofed value as request.ip (PRC-M524 / W1-SEC-07).
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $http_host;
        proxy_set_header X-Forwarded-Port $uatenv_port;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $uatenv_connection;
        # UATENV-D05: Next.js standalone route handlers build absolute redirects
        # from the bind address (HOSTNAME=0.0.0.0); map them back to the public host.
        proxy_redirect ~^http://0\\.0\\.0\\.0:[0-9]+/(.*)$ $scheme://$http_host/$1;`;

function listen(opts, isDefault) {
  const def = isDefault ? ' default_server' : '';
  const lines = [`    listen 29080${def};`];
  if (opts.tlsCert && opts.tlsKey) {
    lines.push(
      `    listen 29090 ssl${def};`,
      `    ssl_certificate ${opts.tlsCert};`,
      `    ssl_certificate_key ${opts.tlsKey};`,
      '    ssl_protocols TLSv1.2 TLSv1.3;',
    );
  }
  return lines.join('\n');
}

function loc(path, upstreamVar, exact = false) {
  return `
    location ${exact ? '= ' : ''}${path} {${proxyCommon}
        proxy_pass $${upstreamVar};
    }`;
}

function tenantLocations(webV1Routes) {
  return [
    ...webV1Routes.map((r) => loc(r, 'up_web', true)),
    loc('^~ /api/v1/', 'up_gateway'),
    loc('/', 'up_web'),
  ].join('\n');
}

/**
 * Keycloak behind auth.<platform>. The admin console and the master realm stay
 * reachable on the loopback listener (SSH tunnel) but are refused on the public
 * TLS listener (29090), so a public UAT never serves them.
 */
function keycloakLocations() {
  const tunnelOnly = (path) => `
    location ^~ ${path} {
        if ($uatenv_public_listener) {
            return 403;
        }${proxyCommon}
        proxy_pass $up_keycloak;
    }`;
  return [tunnelOnly('/admin'), tunnelOnly('/realms/master'), loc('/', 'up_keycloak')].join('\n');
}

const HEALTH_LOCATION = `
    location = /__uatenv_proxy_health {
        access_log off;
        default_type text/plain;
        return 200 'ok';
    }`;

const UPSTREAMS = `
    set $up_web http://web:3001;
    set $up_gateway http://api-gateway:3000;
    set $up_keycloak http://keycloak:8080;
    set $up_registration http://registration-portal:3002;
    set $up_admin http://admin-console:3004;
    set $up_www http://public-website:3003;
    set $up_developers http://developer-portal:3005;`;

/**
 * Render the nginx server config. Upstreams are variables resolved through
 * Docker's DNS at request time, so nginx starts before the apps exist.
 * Unknown host names get 421. Registration-portal tenant hosts
 * (`<slug>.<tenant base>` for UATENV_REGISTRATION_SLUGS) are exact names, so
 * they win over the tenant regex that routes every other slug to web.
 */
export function renderNginxConf(opts, webV1Routes) {
  const tenantRegex = `~^[a-z0-9-]+\\.${opts.tenantBase.replace(/\./g, '\\.')}$`;
  const server = (names, body, isDefault = false) => `
server {
${listen(opts, isDefault)}
    server_name ${names};${UPSTREAMS}
${body}
}`;
  const tenant = tenantLocations(webV1Routes);
  return `# Generated by tools/scripts/uatenv/uatenv-render.mjs - do not edit by hand.
# Host-based routing for the ProctiraERP UAT host (docs/testing/uat/UAT_ENVIRONMENT.md).
resolver 127.0.0.11 valid=10s ipv6=off;
resolver_timeout 5s;
client_max_body_size 50m;
proxy_connect_timeout 60s;
proxy_send_timeout 60s;
proxy_read_timeout 60s;
proxy_buffer_size 128k;
proxy_buffers 4 256k;
proxy_busy_buffers_size 256k;
large_client_header_buffers 4 32k;
server_tokens off;
access_log /dev/stdout;
error_log /dev/stderr warn;

map $http_upgrade $uatenv_connection {
    default upgrade;
    ''      '';
}
map $server_port $uatenv_port {
    default ${opts.port};
}
map $server_port $uatenv_public_listener {
    29090   1;
    default 0;
}
${server('_', `${HEALTH_LOCATION}\n    location / {\n        return 421;\n    }`, true)}
${server('localhost 127.0.0.1', `${HEALTH_LOCATION}\n${tenant}`)}
${server(tenantRegex, tenant)}
${
  opts.registrationSlugs.length
    ? server(
        opts.registrationSlugs.map((s) => `${s}.${opts.tenantBase}`).join(' '),
        loc('/', 'up_registration'),
      )
    : ''
}
${server(opts.apiHost, loc('/', 'up_gateway'))}
${server(opts.authHost, keycloakLocations())}
${server(opts.registerHost, loc('/', 'up_registration'))}
${server(opts.adminHost, loc('/', 'up_admin'))}
${server(opts.wwwHost, loc('/', 'up_www'))}
${server(opts.developersHost, loc('/', 'up_developers'))}
`;
}

/**
 * Render the realm import: no committed users, no dev client secret, UAT
 * redirect URIs and origins, the UAT role catalogue, brute-force protection
 * and a password policy.
 */
export function renderRealm(realm, opts, clientSecret) {
  if (!clientSecret || clientSecret.length < 32 || DEV_CLIENT_SECRETS.has(clientSecret)) {
    throw new Error('renderRealm: a generated client secret (>= 32 chars) is required');
  }
  const out = structuredClone(realm);
  delete out.users;
  out.sslRequired = 'external';
  out.bruteForceProtected = true;
  out.permanentLockout = false;
  out.failureFactor = 10;
  out.passwordPolicy = 'length(14) and notUsername';
  out.registrationAllowed = false;
  out.roles = out.roles ?? {};
  const realmRoles = Array.isArray(out.roles.realm) ? out.roles.realm : [];
  const names = new Set(realmRoles.map((r) => r.name));
  for (const name of UAT_REALM_ROLES) {
    if (!names.has(name)) realmRoles.push({ name, description: `UAT catalogue role ${name}` });
  }
  out.roles.realm = realmRoles;
  const tenantOrigins = opts.slugs.map((s) => opts.origin(`${s}.${opts.tenantBase}`));
  for (const client of out.clients ?? []) {
    if (client.clientId !== 'proctira-gateway') continue;
    client.secret = clientSecret;
    client.redirectUris = [`${opts.origin(opts.apiHost)}/api/v1/auth/callback`];
    client.webOrigins = [...tenantOrigins, opts.origin(opts.apiHost)];
    client.attributes = {
      ...(client.attributes ?? {}),
      'post.logout.redirect.uris': tenantOrigins.map((o) => `${o}/*`).join('##'),
    };
  }
  if (!(out.clients ?? []).some((c) => c.clientId === 'proctira-gateway')) {
    throw new Error('renderRealm: client proctira-gateway not found in the realm file');
  }
  return out;
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function writeOut(file, text, mode) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, text, { mode });
}

function main(argv) {
  const [cmd] = argv;
  const opts = hostOptions();
  if (cmd === 'nginx') {
    const release = arg(argv, '--release');
    const outFile = arg(argv, '--out');
    if (!release || !outFile) throw new Error('nginx: --release and --out are required');
    const routes = webOwnedV1Routes(join(release, 'apps', 'web'));
    writeOut(outFile, renderNginxConf(opts, routes), 0o644);
    console.log(`uatenv-render: nginx config written (${routes.length} web-owned /api/v1 routes)`);
  } else if (cmd === 'realm') {
    const release = arg(argv, '--release');
    const outFile = arg(argv, '--out');
    if (!release || !outFile) throw new Error('realm: --release and --out are required');
    const realm = JSON.parse(
      readFileSync(join(release, 'infra', 'keycloak', 'proctira-realm.json'), 'utf8'),
    );
    const rendered = renderRealm(realm, opts, process.env.KEYCLOAK_CLIENT_SECRET);
    writeOut(outFile, `${JSON.stringify(rendered, null, 2)}\n`, 0o600);
    console.log('uatenv-render: realm import written (users removed, client secret set)');
  } else if (cmd === 'cors') {
    console.log(corsOrigins(opts).join(','));
  } else {
    console.error('usage: uatenv-render.mjs nginx|realm|cors [--release <dir>] [--out <file>]');
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`uatenv-render: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
