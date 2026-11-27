/**
 * Generated per-stack secrets and the compose env file (mode 600).
 *
 * Values are random per stack, live only in `<stateDir>/<project>/aitest.env`,
 * and reach containers through `--env-file` and host services through their
 * environment. They are never placed in argv and never logged.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { PortMap } from '../ports.js';

export interface StackSecrets {
  postgresPassword: string;
  migratorPassword: string;
  appRolePassword: string;
  redisPassword: string;
  rabbitPassword: string;
  minioPassword: string;
  keycloakAdminPassword: string;
  jwtSecret: string;
  cookieSecret: string;
  /** Gateway NODE_ENV=production needs these (config.ts G-703 / PRC-M200 / PRC-M497). */
  auditChainKey: string;
  mfaTicketSecret: string;
}

const SECRET_ENV: Readonly<Record<keyof StackSecrets, string>> = {
  postgresPassword: 'POSTGRES_PASSWORD',
  migratorPassword: 'MIGRATOR_PASSWORD',
  appRolePassword: 'APP_ROLE_PASSWORD',
  redisPassword: 'REDIS_PASSWORD',
  rabbitPassword: 'RABBITMQ_DEFAULT_PASS',
  minioPassword: 'MINIO_ROOT_PASSWORD',
  keycloakAdminPassword: 'KEYCLOAK_ADMIN_PASSWORD',
  jwtSecret: 'JWT_SECRET',
  cookieSecret: 'COOKIE_SECRET',
  auditChainKey: 'AUDIT_CHAIN_HMAC_KEY',
  mfaTicketSecret: 'MFA_PRE_TICKET_SECRET',
};

export const SECRET_ENV_NAMES: readonly string[] = Object.values(SECRET_ENV);

/** URL-safe random token (base64url, no padding). */
function token(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

export function generateSecrets(): StackSecrets {
  return {
    postgresPassword: token(24),
    migratorPassword: token(24),
    appRolePassword: token(24),
    redisPassword: token(24),
    rabbitPassword: token(24),
    minioPassword: token(24),
    keycloakAdminPassword: token(24),
    jwtSecret: token(48),
    cookieSecret: token(48),
    auditChainKey: token(48),
    mfaTicketSecret: token(48),
  };
}

export const MIGRATOR_USER = 'proctira';
export const APP_USER = 'proctira_app';
export const BOOTSTRAP_USER = 'postgres';
export const DATABASE_NAME = 'proctira';

/**
 * Compose env file. Every variable the base compose file interpolates is set,
 * so `docker compose config` resolves without falling back to a shell value.
 * Application-service variables stay empty: aitest never starts those
 * containers (the overlay moves them to a profile).
 */
export function renderEnvFile(
  secrets: StackSecrets,
  ports: PortMap,
  o: { unit: string; extra?: Record<string, string> },
): string {
  const vars: Record<string, string> = {
    AITEST_UNIT: o.unit,
    BIND_ADDRESS: '127.0.0.1',
    APP_BIND_ADDRESS: '127.0.0.1',
    POSTGRES_BOOTSTRAP_USER: BOOTSTRAP_USER,
    POSTGRES_DB: DATABASE_NAME,
    POSTGRES_PORT: String(ports.postgres),
    REDIS_PORT: String(ports.redis),
    KAFKA_PORT: String(ports.kafka),
    KAFKA_AUTO_CREATE_TOPICS: 'true',
    RABBITMQ_DEFAULT_USER: 'proctira',
    RABBITMQ_PORT: String(ports.rabbitmq),
    RABBITMQ_MGMT_PORT: String(ports.rabbitmqMgmt),
    MINIO_ROOT_USER: 'proctira',
    MINIO_API_PORT: String(ports.minio),
    MINIO_CONSOLE_PORT: String(ports.minioConsole),
    KEYCLOAK_ADMIN: 'admin',
    KEYCLOAK_PORT: String(ports.keycloak),
    GATEWAY_PORT: String(ports.gateway),
    ETL_WORKER_PORT: String(ports.etlWorker),
    EXAM_DOCUMENT_WORKER_PORT: String(ports.examDocumentWorker),
    WEB_PORT: String(ports.web),
    REGISTRATION_PORTAL_PORT: String(ports.registrationPortal),
    PUBLIC_WEBSITE_PORT: String(ports.publicWebsite),
    ADMIN_CONSOLE_PORT: String(ports.adminConsole),
    DEVELOPER_PORTAL_PORT: String(ports.developerPortal),
    INSTALL_WIZARD_PORT: String(ports.installWizard),
    // Application containers are never started by aitest; keep them resolvable.
    DATABASE_URL: '',
    REDIS_URL: '',
    KAFKA_BROKERS: '',
    RABBITMQ_URL: '',
    CORS_ORIGINS: '',
    NEXT_PUBLIC_API_URL: '',
    AUTH_SERVICE_URL: '',
    GATEWAY_URL: '',
    S3_ENDPOINT: '',
    S3_REGION: '',
    S3_ACCESS_KEY: '',
    S3_SECRET_KEY: '',
    S3_BUCKET: '',
    ...o.extra,
  };
  for (const [key, env] of Object.entries(SECRET_ENV) as Array<[keyof StackSecrets, string]>) {
    vars[env] = secrets[key];
  }
  for (const [k, v] of Object.entries(vars)) {
    if (/[\n\r]/.test(v)) throw new Error(`env value for ${k} contains a newline`);
  }
  return `${Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')}\n`;
}

export function writeEnvFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) throw new Error(`env file missing: ${path}`);
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

export function secretsFromEnv(vars: Record<string, string>): StackSecrets {
  const out = {} as StackSecrets;
  for (const [key, env] of Object.entries(SECRET_ENV) as Array<[keyof StackSecrets, string]>) {
    const v = vars[env];
    if (!v) throw new Error(`env file has no ${env}`);
    out[key] = v;
  }
  return out;
}

export function pgUrl(user: string, password: string, port: number, db = DATABASE_NAME): string {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${db}`;
}

/** libpq environment for psql/pg_dump (password via PGPASSWORD, never argv). */
export function pgEnv(user: string, password: string, port: number): Record<string, string> {
  return {
    PGHOST: '127.0.0.1',
    PGPORT: String(port),
    PGUSER: user,
    PGPASSWORD: password,
    PGDATABASE: DATABASE_NAME,
  };
}
