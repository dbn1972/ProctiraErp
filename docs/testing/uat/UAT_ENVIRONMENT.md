# UAT environment on the EC2 host

Status: deployed and smoke-tested on commit `219093a4` (21 Nov 2026). Release-plan row E3 is **PARTIAL**; the unmet items are listed in "Smoke results (E3 evidence)" and in `docs/testing/uat/UAT_RELEASE_PLAN.md` row E3.

This page describes the ProctiraERP UAT stack that runs on the shared EC2 build host: what is deployed, how to reach it, the role users, and how to redeploy, reset, back up, restore and tear it down. It names secrets only. Every value lives in the host-only secrets folder.

## Architecture

The stack is the repository's canonical single-host topology (`docker-compose.yml`, W1-OPS-16): every backend domain runs as a Fastify plugin inside one `api-gateway` container, next to the Next.js apps, the two workers and the datastores. One overlay, `infrastructure/uat-ec2/docker-compose.uatenv.yml`, adapts it to this host:

- compose project `proctira-uatenv`, so containers are `proctira-uatenv-<service>-1` and volumes are `proctira-uatenv_*`;
- every published port is on `127.0.0.1` inside 29000-29099; Redis, AMQP, Kafka and the MinIO API are not published;
- production images built locally from the Release workflow Dockerfiles (`infrastructure/docker/Dockerfile.*`, `workers/exam-document/Dockerfile`), tagged `proctira/<service>:uatenv-<sha12>`, never pushed. `NODE_ENV=production`; the gateway runs its `dist/server.js` bundle and the Next.js apps run their standalone `server.js`;
- CPU and memory limits on every service (about 5.4 CPU and 10.6 GB for the core set);
- Keycloak in production mode (`start --import-realm`) on its own `keycloak` Postgres database;
- one nginx reverse proxy (`proxy`, `nginxinc/nginx-unprivileged`, digest-pinned) on `127.0.0.1:29080` with host-based routing;
- json-file logs, 20 MB x 5 files per container;
- MinIO serves TLS from a UAT-internal CA, because the gateway's MinIO adapter refuses plaintext in production (PRC-M542); the gateway trusts the CA through `NODE_EXTRA_CA_CERTS`;
- a stop-gap image layer for UATENV-D01 (see "Defects found while deploying").

The running stack depends only on the host folder `UATENV_HOME` (`/home/ec2-user/ProctiraErp/.agents/tasks/ProctiraErp-uat-environment-ec2`), never on a git worktree:

| Path under `UATENV_HOME`      | Contents                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `runtime/releases/<sha>/`     | source of the deployed commit (`git archive`), the image build context and host `pnpm` tree |
| `runtime/current`             | symlink to the deployed release                                                             |
| `runtime/tooling/`            | copy of `tools/scripts/uatenv/` and `infrastructure/uat-ec2/` the stack and timer use       |
| `runtime/generated/nginx/`    | rendered proxy config (no secrets)                                                          |
| `runtime/generated/tls/`      | MinIO, api-gateway                                                                          | UAT-internal CA and MinIO certificates (public parts only)                                     |
| `runtime/bin/`                | backup and restore                                                                          | `gpg` and `gpg-agent` from the signed Amazon Linux `gnupg2` package (see "Backup and restore") |
| `runtime/state/deployed.json` | deployed SHA, image tag, time, services, CI run                                             |
| `runtime/logs/`               | deploy, build, migration, backup and drill logs                                             |
| `secrets/` (mode 700)         | env files, rendered realm, role-user credentials, backup gpg key (files mode 600)           |
| `backups/` (mode 700)         | encrypted nightly dumps                                                                     |
| `evidence/`                   | health summaries and restore-drill results                                                  |

## Deployed commit

| Item          | Value                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Commit        | `219093a481c7cc02fe76f5372cd1de54f3c0f2e1` (latest `origin/main` commit with a green push CI when the deploy started)                        |
| CI push run   | [CI 44916905863](https://github.com/dbn1972/ProctiraErp/actions/runs/44916905863)                                                            |
| Image tag     | `uatenv-219093a481c7`                                                                                                                        |
| Secondary set | not deployed: admin-console and install-wizard fail to build on `main` until PR #735 merges, so public-website and developer-portal wait too |

## Services, ports and health endpoints

All host ports bind to `127.0.0.1`.

| Service                      | Host port -> container       | Health endpoint                            | CPU / memory |
| ---------------------------- | ---------------------------- | ------------------------------------------ | ------------ |
| proxy (nginx)                | 29080 -> 29080               | `GET /__uatenv_proxy_health`               | 0.2 / 128m   |
| postgres (PostGIS 16)        | 29010 -> 5432                | `pg_isready`                               | 1.0 / 3g     |
| redis (requirepass)          | not published                | `redis-cli ping` with `REDISCLI_AUTH`      | 0.25 / 256m  |
| rabbitmq                     | 29012 -> 15672 (UI)          | `rabbitmq-diagnostics -q ping`             | 0.25 / 512m  |
| kafka (KRaft)                | not published                | `kafka-broker-api-versions`                | 0.5 / 1g     |
| minio (digest-pinned, #708)  | 29016 -> 9001 (UI)           | `/minio/health/live`                       | 0.25 / 256m  |
| keycloak 26                  | 29020 -> 8080, 29021 -> 9000 | `:29021/health/ready`                      | 0.75 / 1280m |
| api-gateway                  | 29030 -> 3000                | `/health`, `/health/live`, `/health/ready` | 1.0 / 2g     |
| web                          | 29031 -> 3001                | `/api/health`                              | 0.5 / 1g     |
| registration-portal          | 29032 -> 3002                | `/api/health`                              | 0.3 / 512m   |
| etl-worker                   | 29040 -> 3010                | `/health/ready`                            | 0.2 / 384m   |
| exam-document-worker         | 29041 -> 3025                | `/health/ready`                            | 0.2 / 384m   |
| public-website (secondary)   | 29033 -> 3003                | `/api/health`                              | 0.15 / 384m  |
| admin-console (secondary)    | 29034 -> 3004                | `/api/health`                              | 0.15 / 384m  |
| developer-portal (secondary) | 29035 -> 3005                | `/api/health`                              | 0.15 / 384m  |
| install-wizard (secondary)   | 29036 -> 3100 (not proxied)  | `/api/health`                              | 0.15 / 384m  |

Ports 29090-29099 are reserved for a future public TLS listener. `tools/scripts/uatenv/uatenv-health.sh [--json <file>]` probes every row above, directly and through the proxy, and exits non-zero on any failure.

## Host names and routing

Everything goes through the proxy on port 29080. The `*.localhost` names resolve to loopback in Chrome and Firefox without DNS or `/etc/hosts`, so they work through the SSH tunnel.

| URL                                                     | Goes to                                                                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `http://sunrise-public-school.proctira.localhost:29080` | tenant A (Sunrise Public School demo): `/api/v1/*` to the gateway except the web-owned `/api/v1` routes; rest to web |
| `http://e2e-tenant-a.proctira.localhost:29080`          | tenant B (`e2e-tenant-a`), same routing                                                                              |
| `http://localhost:29080`                                | same as tenant A (`TENANT_FALLBACK_SLUG=sunrise-public-school`)                                                      |
| `http://api.proctira-uat.localhost:29080`               | api-gateway (also the Keycloak login/callback endpoints `/api/v1/auth/*`)                                            |
| `http://auth.proctira-uat.localhost:29080`              | Keycloak (login pages, `/admin/`)                                                                                    |
| `http://register.proctira-uat.localhost:29080`          | registration portal                                                                                                  |
| `http://e2e-registration.proctira.localhost:29080`      | registration portal for the registration fixture tenant (the gateway resolves the tenant from the host)              |
| any other host                                          | `421 Misdirected Request`                                                                                            |

The web-owned `/api/v1` routes are read from `apps/web/src/app/api/v1/**/route.ts` of the deployed commit at render time (today: `institutions/directory-context`, `notifications/unread-count`, `tenant/branding`). Inside the compose network the proxy also answers as `api.proctira-uat.localhost` and `auth.proctira-uat.localhost`, so the browser and the server-side calls use the same URLs (`GATEWAY_URL`, `KEYCLOAK_ISSUER`).

## Access (SSH tunnel)

The stack is not reachable from outside the host. Open a tunnel from your machine:

```bash
ssh -N -L 29080:127.0.0.1:29080 ec2-user@<ec2-public-dns>
```

Then open `http://sunrise-public-school.proctira.localhost:29080/login` in Chrome or Firefox. Add `-L 29012:127.0.0.1:29012 -L 29016:127.0.0.1:29016` for the RabbitMQ and MinIO consoles (credentials: `RABBITMQ_DEFAULT_USER`/`RABBITMQ_DEFAULT_PASS` and `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` in `secrets/uatenv.env`). Safari does not resolve `*.localhost`; add these lines to `/etc/hosts` on your machine instead:

```text
127.0.0.1 sunrise-public-school.proctira.localhost e2e-tenant-a.proctira.localhost
127.0.0.1 api.proctira-uat.localhost auth.proctira-uat.localhost register.proctira-uat.localhost
127.0.0.1 e2e-registration.proctira.localhost
```

The apps run with `NODE_ENV=production`, so auth cookies carry `Secure`. Browsers accept `Secure` cookies on `localhost` and `*.localhost` over plain HTTP; any other host name needs the TLS setup in "Public exposure".

## Role users

One Keycloak user per role the role catalogue and gateway support. Passwords are generated on the host and stored only in `secrets/uat-users.tsv` (mode 600, columns `username role tenant_slug login_host password`). Log in through the tenant host in the `login_host` column.

| Username                                  | Realm role          | Represents                    | Tenant                  |
| ----------------------------------------- | ------------------- | ----------------------------- | ----------------------- |
| `uat-platform-admin@proctira-uat.test`    | `super-admin`       | platform admin                | `sunrise-public-school` |
| `uat-tenant-admin@proctira-uat.test`      | `admin`             | tenant admin                  | `sunrise-public-school` |
| `uat-principal@proctira-uat.test`         | `principal`         | principal                     | `sunrise-public-school` |
| `uat-teacher@proctira-uat.test`           | `teacher`           | teacher                       | `sunrise-public-school` |
| `uat-staff@proctira-uat.test`             | `staff`             | non-teaching staff            | `sunrise-public-school` |
| `uat-bursar@proctira-uat.test`            | `bursar`            | finance officer / bursar      | `sunrise-public-school` |
| `uat-registrar@proctira-uat.test`         | `registrar`         | registrar                     | `sunrise-public-school` |
| `uat-warden@proctira-uat.test`            | `warden`            | hostel warden                 | `sunrise-public-school` |
| `uat-transport-officer@proctira-uat.test` | `transport_officer` | transport officer             | `sunrise-public-school` |
| `uat-nurse@proctira-uat.test`             | `nurse`             | health staff                  | `sunrise-public-school` |
| `uat-librarian@proctira-uat.test`         | `librarian`         | librarian                     | `sunrise-public-school` |
| `uat-parent@proctira-uat.test`            | `guardian`          | parent                        | `sunrise-public-school` |
| `uat-student@proctira-uat.test`           | `student`           | student                       | `sunrise-public-school` |
| `uat-b-tenant-admin@proctira-uat.test`    | `admin`             | tenant B admin (cross-tenant) | `e2e-tenant-a`          |
| `uat-b-teacher@proctira-uat.test`         | `teacher`           | tenant B teacher              | `e2e-tenant-a`          |

Each user carries the `tenant_id` and `tenant_slug` attributes that the realm's token mappers emit. The realm user profile is set to `unmanagedAttributePolicy: ADMIN_EDIT`, so the attributes reach the tokens but users cannot edit them. `uatenv-keycloak.sh --verify` takes a direct-grant token for every user and checks `iss`, `tenant_id`, `tenant_slug` and the role (claim names only, no values).

Keycloak admin console: `http://auth.proctira-uat.localhost:29080/admin/` with `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` from `secrets/uatenv.env`.

## Data

- Tenant A: Sunrise Public School demo, `db/seeds/006_sunrise_public_school_demo.sql`, applied with `PGOPTIONS='-c proctira.allow_demo_seed=on'` (5 institutions, 3,619 students, 249 staff).
- Tenant B and the other E2E tenants: `tools/e2e/seed-e2e-tenants.sql` (`e2e-tenant-a` has 1 institution and 6 students).
- Registration fixture: `tools/e2e/seed-e2e-registration.sql` (tenant `e2e-registration`, one institution with a published admission form).
- Portal links: `uatenv-link-portal-users.sh` (run by the deploy `apps` stage and by `uatenv-reset-data.sh`) signs `uat-parent` and `uat-student` in once through the gateway password route so the gateway creates their local user ids, then links `uat-parent` to Sunrise student `00000000-0000-4000-8000-00000000a5b1` (`parent_child_links`, active) and binds `uat-student` to the same student (`students.custom_data.user_id`, the PRC-H075 self-binding). Without it both portals show "no linked children" / "not available for your account".

## Database roles

`uatenv-db-bootstrap.sh` follows `.github/workflows/e2e-backend-ready.yml`: `bootstrap-db-roles.sh` with `BOOTSTRAP_PIN_MIGRATOR_ATTRIBUTES=1 NODE_ENV=production`, then the CI role-attribute checks.

| Role              | Attributes                                             | Used by                                                             |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| `postgres`        | container bootstrap superuser                          | role bootstrap, reset, restore drill (host scripts only)            |
| `proctira`        | migrator, table owner, NOSUPERUSER NOBYPASSRLS         | migrations and seeds (host scripts only)                            |
| `proctira_app`    | runtime, NOSUPERUSER NOBYPASSRLS, owns no tables       | api-gateway, workers (`DATABASE_URL`)                               |
| `proctira_backup` | NOSUPERUSER BYPASSRLS + `pg_read_all_data`             | nightly `pg_dump` (`pg-backup.sh` refuses roles without RLS bypass) |
| `keycloak`        | NOSUPERUSER NOBYPASSRLS, owns database `keycloak` only | Keycloak                                                            |

`CONNECT` on `proctira` and `keycloak` is revoked from `PUBLIC`. Migrations use the production path `tools/scripts/run-target-database-migrations.sh` (Prisma `migrate deploy` plus `apply-sql.sh` with `APPLY_STRICT_FKS=1 APPLY_SEEDS=0`, ledger check), then `assert-runtime-database-role.sh` and `assert-runtime-schema-ready.sh`, as in `deploy.yml`.

## Secrets

`tools/scripts/uatenv/uatenv-secrets.sh` generates every value with `openssl rand` the first time and never replaces an existing one. `uatenv-secrets.sh --names` prints key names only.

| File                                    | Read by                       | Holds (names)                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `secrets/uatenv.env`                    | the compose CLI               | datastore passwords, `DATABASE_URL` (runtime role), `REDIS_URL`, `RABBITMQ_URL`, `JWT_SECRET`, `COOKIE_SECRET`, Keycloak admin and client secret, MinIO keys, routing settings                                                                                                                                                                                                       |
| `secrets/gateway.env`                   | api-gateway only (`env_file`) | signing secrets (audit chain, transcript, board export, report download, LMS file, admissions offer, registration challenge, scholarship document URL), `SCIM_TOKEN_PEPPER`, `MFA_PRE_TICKET_SECRET`, ETL connector key, metrics token, PHI and webhook KMS stub settings (`PHI_KMS_KEY_ID`, a random `PHI_ENCRYPTION_KEY` stub root), `QUEUE_BACKEND=rabbitmq`, `RABBITMQ_EXCHANGE` |
| `secrets/ops.env`                       | host scripts only             | `BOOTSTRAP_DATABASE_URL`, `MIGRATOR_DATABASE_URL`, `RUNTIME_DATABASE_URL`, `BACKUP_DATABASE_URL`, `KEYCLOAK_DATABASE_URL`, backup settings                                                                                                                                                                                                                                           |
| `secrets/generated/keycloak-realm.json` | Keycloak (import)             | realm with the generated client secret                                                                                                                                                                                                                                                                                                                                               |
| `secrets/uat-users.tsv`                 | operators, smoke tests        | role-user usernames and passwords                                                                                                                                                                                                                                                                                                                                                    |
| `secrets/gnupg/`                        | backup and restore            | backup encryption key (no passphrase)                                                                                                                                                                                                                                                                                                                                                |
| `secrets/tls/`                          | MinIO, secrets script         | private keys of the UAT-internal CA and the MinIO certificate                                                                                                                                                                                                                                                                                                                        |

No container receives the migrator, superuser or backup credentials. The scripts pass passwords to `psql`, `pg_dump` and `curl` through environment variables or stdin, never on the command line. Exception: the repository's `run-target-database-migrations.sh` and `apply-sql.sh` pass `MIGRATOR_DATABASE_URL` to `psql` as an argument, so the migrator URL is visible in the host process list while migrations run.

## Redeploy, reset and teardown

All scripts live in `tools/scripts/uatenv/`; run the copies in `runtime/tooling/tools/scripts/uatenv/`. Run `~/bin/server-guard.sh` first; the scripts also wait for it before heavy steps.

```bash
UATENV=/home/ec2-user/ProctiraErp/.agents/tasks/ProctiraErp-uat-environment-ec2/runtime/tooling/tools/scripts/uatenv

# Redeploy to another main commit (its CI push run must be green):
git -C /home/ec2-user/ProctiraErp fetch origin
bash $UATENV/uatenv-redeploy.sh <40-char sha> [--with-secondary] [--tooling-ref origin/main]

# Reset application data to the seeded state (asks you to type proctira-uatenv):
bash $UATENV/uatenv-reset-data.sh

# Health check:
bash $UATENV/uatenv-health.sh

# Tear down (manual only; asks for proctira-uatenv; --volumes asks again for delete-volumes):
bash $UATENV/uatenv-teardown.sh [--volumes]
```

`uatenv-redeploy.sh` extracts the commit with `git archive` from the shared object store, builds the images one at a time, takes a pre-migration backup, runs the production migrations, recreates the services and waits for health. If the new services do not become healthy it brings the previous release back up. Schema changes are forward-only, so a rollback relies on the previous images tolerating the newer schema. It keeps the current and previous releases and images and prunes older ones. `--with-secondary` adds public-website, admin-console, developer-portal and install-wizard (after PR #735 is on `main`).

`uatenv-reset-data.sh` stops the apps, drops database `proctira`, re-runs roles, migrations and seeds, flushes Redis, empties the MinIO bucket, starts the apps and re-links the portal users. Keycloak and the role users are kept.

First install (already done on this host): `uatenv-deploy.sh --sha <sha> [--stage prepare|build|data|keycloak|apps|ops]`.

## Restart on reboot

Every service has `restart: unless-stopped` (from `docker-compose.yml`) and `docker.service` is enabled at boot, so a host reboot brings the stack back without a systemd unit for the stack. A container stopped with `docker compose stop` stays stopped until it is started again. The nightly backup is a systemd user timer; `Linger=yes` for `ec2-user` keeps it running across reboots.

## Backup and restore

- Schedule: `proctira-uatenv-backup.timer` (systemd user timer), daily at 02:30 server time with up to 10 minutes of random delay; missed runs catch up at boot.
- What: `tools/scripts/pg-backup.sh` dumps database `proctira` as `proctira_backup` (custom format); `pg_dump` dumps database `keycloak` as its owner.
- Encryption: gpg to the local key `proctira-uatenv-backup@localhost` in `secrets/gnupg` (`BACKUP_ENCRYPT=1`, so no plaintext dump is kept). Amazon Linux 2023 ships `gnupg2-minimal`, which has no `gpg-agent` (no key generation or decryption) and no `--trust-model` (used by `tools/scripts/backup-crypto.sh`). Without sudo, the scripts take `gpg` and `gpg-agent` from the signed `gnupg2` package of the same version (`dnf download`, `rpm -K` must report `digests signatures OK`) into `runtime/bin/` and point the keyring at that agent.
- Where: `backups/proctira-<ts>.dump.gpg` and `backups/keycloak-<ts>.dump.gpg`, mode 600.
- Retention: 7 days (`BACKUP_RETENTION_DAYS=7`).
- Log: `runtime/logs/backup-nightly.log`.
- Restore drill: `uatenv-restore-drill.sh` restores the newest dump into a scratch database `proctira_restore_drill_<ts>` with `tools/scripts/pg-restore.sh`, compares row counts with the source, writes `evidence/restore-drill-<ts>.json` and drops the scratch database.

Manual commands:

```bash
bash $UATENV/uatenv-backup.sh
bash $UATENV/uatenv-restore-drill.sh
systemctl --user list-timers proctira-uatenv-backup.timer
```

Drill result: see "Deploy evidence" below. The timer has also run unattended on 22 and 23 Nov 2026 (`Result=success`, two encrypted artifacts each night).

## Logs

- Container logs: `docker compose -p proctira-uatenv logs <service>` or `docker logs proctira-uatenv-<service>-1` (json-file, 20 MB x 5 per container).
- Proxy access log: `docker logs proctira-uatenv-proxy-1`.
- Script logs: `runtime/logs/` (deploy stages, image builds, `pnpm install`, migrations, restore drills, nightly backup).

## External providers (sandbox or disabled)

| Integration                             | UAT setting                                                                                     | Pending owner                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Payments (Razorpay)                     | no keys; `FEES_STAFF_SANDBOX_PAYMENTS=false`                                                    | Razorpay test keys                              |
| SMS / OTP (MSG91, Twilio)               | console provider (`PROVIDER_MODE=sandbox`, `ALLOW_SANDBOX_PROVIDERS=1`), `MFA_EXPOSE_OTP=false` | MSG91 credentials                               |
| Email (SES / SMTP)                      | `SMTP_HOST` unset (sandbox delivery)                                                            | SES credentials                                 |
| Push (FCM)                              | `FCM_*` unset                                                                                   | FCM service account                             |
| DNS (Route 53)                          | none; `*.localhost` names                                                                       | Route 53 access for public exposure / DNS-01    |
| PHI envelope encryption (AWS KMS)       | `PHI_ENVELOPE_PROVIDER=local-stub` + `ALLOW_PHI_KMS_STUB=1`                                     | KMS key                                         |
| Webhook signing (AWS KMS)               | `WEBHOOK_SIGNING_KMS_CLIENT=local-stub` + `ALLOW_WEBHOOK_KMS_STUB=1`                            | KMS key                                         |
| Transcript signing                      | `TRANSCRIPT_SIGNING_KMS_KEY_REF=env:TRANSCRIPT_SIGNING_SECRET`                                  | KMS key                                         |
| Tenant onboarding Keycloak provisioning | `KEYCLOAK_ADMIN_CLIENT_*` unset (role users created by `uatenv-keycloak.sh`)                    | service-account client, if onboarding is tested |

Payments cannot be exercised: with `NODE_ENV=production` the web refuses the sandbox payment method (`apps/web/src/lib/fees/validation.ts`) and no Razorpay test keys are configured.

## Known limitations and deviations

- `RATE_LIMIT_MAX_REQUESTS=600` (production default 100): every server-side web call reaches the gateway from the web container's address through the proxy, so 100 per minute would throttle a render pass.
- Kafka keeps `KAFKA_AUTO_CREATE_TOPICS=true`; the repository has no topic-provisioning script.
- `TENANT_FALLBACK_SLUG=sunrise-public-school`, so bare `localhost:29080` serves tenant A (needed by Playwright specs that use a `localhost` cookie domain).
- One OIDC return address (`NEXT_PUBLIC_WEB_URL` = the Sunrise host), so tenant B users return to the Sunrise host after Keycloak login.
- The backup key and the dumps are on the same host, and there is no offsite copy.
- MinIO uses its root credentials as the application S3 keys (single-tenant UAT object store).
- The migrator URL is visible in the host process list while migrations run (see "Secrets").
- No host reboot was exercised (shared host); restart behaviour is proven with `docker compose restart` and the restart policy.
- The Keycloak bootstrap admin (`KEYCLOAK_ADMIN`) is Keycloak's temporary admin account; replace it with a permanent admin before any wider use.
- The deployed backend images carry the UATENV-D01 stop-gap layer. The Release Dockerfile fix is on `main` (#757); the layer is skipped automatically once a redeployed image already has the OpenSSL 3 engine.
- The proxy rewrites `Location: http://0.0.0.0:<port>/...` redirects to the public host (UATENV-D05). The web fix is on `main` (#755); the rewrite is harmless after the redeploy and can then be removed.
- Secondary apps (public-website, admin-console, developer-portal, install-wizard) are not deployed until PR #735 is on `main`.
- Playwright specs that sign HS256 session cookies or open the database directly cannot run against this Keycloak-mode stack (see "Smoke results").

## Public exposure (not enabled)

The stack is loopback-only by design. To expose it, the owner must provide:

1. A DNS name: a wildcard such as `*.uat.<domain>` for tenant hosts, plus `api.`, `auth.` and `register.` under a platform domain, pointing at the EC2 public IP (Route 53 or the owner's DNS).
2. A security-group rule: inbound TCP 443 from the owner's CIDRs only (plus TCP 80 only if HTTP-01 validation is used).
3. TLS: a Let's Encrypt certificate (DNS-01 for the wildcard, which needs DNS API access) or ACM on an ALB in front of the host. With ACM/ALB, keep the proxy on loopback and point the ALB at it instead.

Config change for the on-host TLS option:

```bash
# in secrets/uatenv.env (then regenerate derived URLs, see below)
UATENV_TENANT_BASE_DOMAIN=uat.<domain>
UATENV_PLATFORM_DOMAIN=platform.uat.<domain>
UATENV_PUBLIC_SCHEME=https
UATENV_PUBLIC_PORT=443
# exported in the shell that runs the scripts
export UATENV_PUBLIC_TLS=1 UATENV_PUBLIC_BIND=0.0.0.0
export UATENV_TLS_CERT=/path/fullchain.pem UATENV_TLS_KEY=/path/privkey.pem
```

Delete the derived keys (`KEYCLOAK_ISSUER`, `KEYCLOAK_REDIRECT_URI`, `NEXT_PUBLIC_WEB_URL`, `CORS_ORIGINS`, `GATEWAY_URL`, `NEXT_PUBLIC_API_URL`) from `secrets/uatenv.env` so `uatenv-secrets.sh` regenerates them for the new names, then run `uatenv-redeploy.sh <current sha>`. The renderer adds a `listen 29090 ssl` server block, `infrastructure/uat-ec2/docker-compose.uatenv-public.yml` publishes it on `UATENV_PUBLIC_BIND:443` and mounts the certificate (readable by uid 101), and the realm redirect URIs and web origins follow the new names. No image rebuild is needed, because no `NEXT_PUBLIC_*` host name is baked into the builds.

## Smoke results (E3 evidence)

Smoke run on the deployed commit `219093a4`, 21 Nov 2026, 18:51-21:58 UTC. Evidence files are in `UATENV_HOME/evidence/` (summary: `smoke-summary.md`); the defect ledger is `UATENV_HOME/defects.md`.

| #   | Smoke item                                                  | Result                         | Counts                                                                                                                                                                                                                                                                   | Evidence                                                  |
| --- | ----------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| 1   | Every service healthy                                       | PASS                           | 34/34 probes; 34/34 again after `docker compose -p proctira-uatenv restart` (healthy 80 s later); all listeners on `127.0.0.1`; protected containers unchanged                                                                                                           | `smoke-services.md`, `restart-proof-smoke.md`             |
| 2   | Each role user logs in through Keycloak via the proxy       | PARTIAL                        | Keycloak login via the proxy 15/15 (15/15 after the restart). Right home screen 0/15: no roles in the web session (D06), guarded homes show the error boundary (D12), portal users land on `/` (D13). Email/password form returns 401 (D08)                              | `logins.md`, `logins.json`, `logins/`                     |
| 3   | Playwright nightly spec set                                 | PARTIAL                        | 59 specs: 6 compatible specs run and pass (19 tests), 53 incompatible; the run surfaced D14. 494 tests: 251 passed, 234 failed, 9 skipped. The 53 incompatible specs sign HS256 session JWTs (`e2e/fixtures/fake-session.ts` and portal fixtures); 5 also need DB access | `playwright/classification.md`, `playwright/nightly.json` |
| 4   | Render pass (209 routes from the per-screen checklist)      | FAIL                           | 17 PASS, 177 FAIL, 15 SKIPPED (no fixture id, D17). Allow checks 20/180, deny checks 13/150, portal bounce 0/25, public 14/14. Raw server text on 0 pages. 274 of the 322 failed checks trace to D06 and D12                                                             | `render-pass.md`, `render-pass.json`, `render/shots/`     |
| 5   | Cross-tenant spot checks (5 screens each way, plus the API) | PASS on the API, PARTIAL on UI | 13 PASS, 0 FAIL, 13 INCONCLUSIVE. No tenant-B row reached tenant A (or the reverse) on any rendered screen or gateway call, including a spoofed `X-Tenant-ID`. Only the dashboard rendered data; the other screens showed the D06/D12 error boundary                     | `cross-tenant.md`, `cross-tenant.json`, `cross-tenant/`   |
| 6   | Failures recorded as defects                                | DONE                           | 17 ledger rows (below); the 9 code defects are fixed on `main`                                                                                                                                                                                                           | `defects.md`                                              |

The code fixes for every smoke failure above are merged to `main` (tip `45cf9c68`) but are not yet deployed. After a redeploy with `uatenv-redeploy.sh`, re-run smoke items 2, 3 (axe specs), 4 and 5 before E3 can move to PASSED.

## Defects

Full ledger with requests, responses and evidence: `UATENV_HOME/defects.md`. Code defects were fixed in separate PRs with failing-first tests, review and green required checks.

| Id         | Class                      | Finding                                                                                                                                | Status                                                                                                      |
| ---------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| UATENV-D01 | code (Release Dockerfiles) | api-gateway, etl-worker and exam-document-worker images carry only the OpenSSL 1.1 Prisma engine and crash at boot on Alpine           | merged #757 (`c3053045`); UAT uses the stop-gap layer `Dockerfile.prisma-openssl3` until redeploy           |
| UATENV-D02 | config (Helm allowlist)    | `SCIM_TOKEN_PEPPER` and `MFA_PRE_TICKET_SECRET` are missing from Helm `serviceKeys.api-gateway` and from the allowlist check           | worked around in `secrets/gateway.env`; repo fix PR pending                                                 |
| UATENV-D03 | config (compose)           | compose passes neither `RABBITMQ_URL` nor `RABBITMQ_EXCHANGE` to the gateway                                                           | fixed in the environment (`secrets/gateway.env`)                                                            |
| UATENV-D04 | config (compose, Helm)     | etl-worker needs `JWT_SECRET` in production (PRC-M030); compose and Helm do not pass it                                                | worked around in the overlay; repo fix PR pending                                                           |
| UATENV-D05 | code (web callback)        | the login callback redirects to the container bind address `http://0.0.0.0:3001/`                                                      | merged #755 (`45cf9c68`); UAT uses the nginx `proxy_redirect` workaround until redeploy                     |
| UATENV-D06 | code (web session)         | Keycloak sessions carry no roles and no tenant in the web; the web uses the raw Keycloak `sub`                                         | merged #754 (`372dcf72`); UAT re-run pending redeploy                                                       |
| UATENV-D07 | code (gateway Keycloak)    | the gateway drops every realm role outside the six built-ins (bursar, registrar, warden, transport_officer, nurse, librarian, student) | merged #753 (`de89a647`); `librarian` still maps to nothing (see D10); UAT re-run pending redeploy          |
| UATENV-D08 | code (web password login)  | the email/password form posts to `/auth/login`, which returns 401 in Keycloak mode                                                     | merged #755 (`45cf9c68`); UAT re-run pending redeploy                                                       |
| UATENV-D09 | product                    | one OIDC return origin, so tenant-B users return to the Sunrise host after login (no data leak)                                        | pending owner                                                                                               |
| UATENV-D10 | product                    | bursar and librarian hold no gateway fees or library grant                                                                             | pending owner                                                                                               |
| UATENV-D11 | config (Helm ingress)      | Helm ingress would route the web BFF `/api/auth/*` to the gateway on tenant hosts (code reading; not exercised on this host)           | pending owner                                                                                               |
| UATENV-D12 | code (web route guards)    | guards throw `TypeError` on a missing `roles` array instead of showing access denied                                                   | merged #754 (`372dcf72`); UAT re-run pending redeploy                                                       |
| UATENV-D13 | code (web portal landing)  | parent and student land on the staff dashboard `/`                                                                                     | merged #754 (`372dcf72`); UAT re-run pending redeploy                                                       |
| UATENV-D14 | code (web a11y)            | error-state reference line has 2.75:1 contrast (WCAG AA needs 4.5:1)                                                                   | merged #756 (`33434736`); axe specs need a UAT re-run                                                       |
| UATENV-D15 | config (environment)       | UAT parent and student accounts were not linked to any student                                                                         | fixed in the environment (`uatenv-link-portal-users.sh`)                                                    |
| UATENV-D16 | code (web session refresh) | refresh posts to `/auth/refresh` and fails, so users are signed out after 5 minutes                                                    | merged #755 (`45cf9c68`); UAT re-run pending redeploy; residual: a user idle over 300 s returns to `/login` |
| UATENV-D17 | product (demo seed)        | the Sunrise seed has no rows for 15 detail routes                                                                                      | pending owner                                                                                               |

## Pending owner

- Redeploy UAT to a green `main` commit that contains #753-#757 (tip `45cf9c68` once its push CI is green), then re-run smoke items 2-5.
- PR #735 (admin-console and install-wizard builds), then `uatenv-redeploy.sh <sha> --with-secondary`.
- Decisions: D09 (per-tenant OIDC return origin), D10 (bursar and librarian grants), D11 (Helm ingress routing), D17 (demo seed coverage).
- Repo config fix PRs for D02 and D04 (Helm and compose).
- External provider credentials: Razorpay test keys (payments cannot be exercised until then), MSG91, SES, FCM, AWS KMS keys, and a Keycloak service-account client if tenant onboarding is tested.
- Public exposure inputs: DNS name, security-group rule and TLS (see "Public exposure").
- A host reboot test, when the shared host can be rebooted.

## Deploy evidence

Host evidence lives in `UATENV_HOME/evidence/` (21 Nov 2026, commit `219093a4`).

| Check                        | Result                                                                                                                                                                                                                         | Evidence                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Roles and migrations         | `run-target-database-migrations: PASS` (192 db/sql migrations), `assert-runtime-database-role: PASS`, `assert-runtime-schema-ready: PASS`; `proctira` and `proctira_app` NOSUPERUSER NOBYPASSRLS                               | `db-provisioning.md`                                |
| Seeds                        | Sunrise 5 institutions / 3,619 students / 249 staff; `e2e-tenant-a` 1 institution / 6 students; `e2e-registration` 1 institution                                                                                               | `db-provisioning.md`                                |
| Keycloak users               | 15 users created; direct-grant token for every user carries the expected `iss`, `tenant_id`, `tenant_slug` and realm role                                                                                                      | deploy log, `reset-proof.md`                        |
| Services                     | 12 core containers healthy; 34/34 health probes pass (direct, through the proxy, Redis `requirepass`, unknown host 421)                                                                                                        | `services-20261121T182749Z.json`                    |
| Loopback only                | every listener in 29000-29099 is on `127.0.0.1`; Redis, AMQP, Kafka and the MinIO API are not published                                                                                                                        | `ss -ltnH` in `deploy.md`                           |
| In-network names             | gateway -> `auth.proctira-uat.localhost:29080` 200; web -> `api.proctira-uat.localhost:29080` 200 (compose network aliases, no fallback needed)                                                                                | `deploy.md`                                         |
| Login path through the proxy | Chromium: `/api/auth/keycloak` -> gateway `/api/v1/auth/login` -> Keycloak form -> gateway callback -> web callback -> `/` (after the UATENV-D05 proxy fix); role mapping is the smoke step's check                            | `deploy.md`                                         |
| `docker compose restart`     | all services healthy again within about 90 s; 34/34 probes pass; restart policy `unless-stopped` on every container; `docker.service` enabled                                                                                  | `restart-proof.md`, `services-after-restart-*.json` |
| Reset data                   | typed `no` aborts with nothing changed; typed `proctira-uatenv` drops and re-seeds (marker row gone, seed counts restored) in about 5 minutes; Keycloak users kept                                                             | `reset-proof.md`                                    |
| Nightly backup               | `proctira-uatenv-backup.timer` enabled (next run 02:30 UTC); first run through the systemd unit: `Result=success`, 2 encrypted artifacts (mode 600)                                                                            | `backup-restore.md`                                 |
| Restore drill                | newest dump restored into `proctira_restore_drill_<ts>` in 8 s; row counts match (tenants 10, institutions 7, students 3,625, staff 249, schema_migrations 192, _prisma_migrations 10, guardian_households 3); scratch dropped | `restore-drill-20261121T184534Z.json`               |
| Protected containers         | the 16 `proctira-staging-*`, `proctira-erp-*`, `serviceformai-*`, `lanea-pg-43848`, `pc-back2-rmq` containers have the same id, state, start time and restart count as before the deploy                                       | `preflight-protected.txt`, `deploy.md`              |
