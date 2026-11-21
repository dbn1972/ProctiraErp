#!/usr/bin/env bash
# Generate the UAT host secrets (idempotent; existing values are never replaced).
#
#   secrets/uatenv.env   compose interpolation (read by the compose CLI only)
#   secrets/gateway.env  api-gateway-only runtime secrets (env_file)
#   secrets/ops.env      host scripts only: bootstrap/migrator/backup URLs
#
# Every file is mode 600 in a mode 700 directory. Values are random hex from
# openssl and are never printed; `--names` lists key names only.
set -euo pipefail
# shellcheck source=uatenv-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/uatenv-lib.sh"

if [[ "${1:-}" == "--names" ]]; then
  for f in uatenv.env gateway.env ops.env; do
    echo "# $f"
    cut -d= -f1 "$UATENV_SEC/$f"
  done
  exit 0
fi

umask 077
mkdir -p "$UATENV_SEC/generated" "$UATENV_SEC/playwright-state"
chmod 700 "$UATENV_SEC" "$UATENV_SEC/generated" "$UATENV_SEC/playwright-state"

hex() { openssl rand -hex "${1:-32}"; }

# ensure FILE KEY VALUE: append KEY=VALUE only when KEY is absent.
ensure() {
  local file="$1" key="$2" value="$3"
  touch "$file"
  chmod 600 "$file"
  if ! grep -q "^$key=" "$file"; then
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}
get() { env_file_get "$1" "$2"; }

U="$UATENV_SEC/uatenv.env"
G="$UATENV_SEC/gateway.env"
O="$UATENV_SEC/ops.env"

PROXY_IMAGE_DEFAULT='nginxinc/nginx-unprivileged:1.27-alpine@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0'
PLATFORM="${UATENV_PLATFORM_DOMAIN:-proctira-uat.localhost}"
TENANT_BASE="${UATENV_TENANT_BASE_DOMAIN:-proctira.localhost}"
SCHEME="${UATENV_PUBLIC_SCHEME:-http}"
PORT="${UATENV_PUBLIC_PORT:-29080}"
PUBLIC_SUFFIX=":$PORT"
if [[ "$SCHEME:$PORT" == "https:443" || "$SCHEME:$PORT" == "http:80" ]]; then PUBLIC_SUFFIX=''; fi

# --- Host / routing (non-secret, but kept with the stack's config) ----------
ensure "$U" UATENV_PROXY_IMAGE "$PROXY_IMAGE_DEFAULT"
ensure "$U" UATENV_BIND 127.0.0.1
ensure "$U" UATENV_PROXY_BIND 127.0.0.1
ensure "$U" UATENV_PROXY_PORT 29080
ensure "$U" UATENV_PLATFORM_DOMAIN "$PLATFORM"
ensure "$U" UATENV_TENANT_BASE_DOMAIN "$TENANT_BASE"
ensure "$U" UATENV_PUBLIC_SCHEME "$SCHEME"
ensure "$U" UATENV_PUBLIC_PORT "$PORT"
ensure "$U" UATENV_SUBNET 172.29.90.0/24
ensure "$U" UATENV_TENANT_SLUGS sunrise-public-school,e2e-tenant-a
ensure "$U" UATENV_REGISTRATION_SLUGS e2e-registration
ensure "$U" NODE_ENV production
ensure "$U" LOG_LEVEL info

# --- Postgres -----------------------------------------------------------------
ensure "$U" POSTGRES_BOOTSTRAP_USER postgres
ensure "$U" POSTGRES_DB proctira
ensure "$U" POSTGRES_PASSWORD "$(hex 24)"
ensure "$U" MIGRATOR_PASSWORD "$(hex 24)"
ensure "$U" APP_ROLE_PASSWORD "$(hex 24)"
ensure "$U" KEYCLOAK_DB_PASSWORD "$(hex 24)"
ensure "$U" DATABASE_URL "postgresql://proctira_app:$(get "$U" APP_ROLE_PASSWORD)@postgres:5432/proctira"

# --- Redis / RabbitMQ / Kafka / MinIO ------------------------------------------
ensure "$U" REDIS_PASSWORD "$(hex 24)"
ensure "$U" REDIS_URL "redis://:$(get "$U" REDIS_PASSWORD)@redis:6379"
ensure "$U" RABBITMQ_DEFAULT_USER proctira
ensure "$U" RABBITMQ_DEFAULT_PASS "$(hex 24)"
ensure "$U" RABBITMQ_URL "amqp://proctira:$(get "$U" RABBITMQ_DEFAULT_PASS)@rabbitmq:5672"
ensure "$U" KAFKA_BROKERS kafka:29092
ensure "$U" MINIO_ROOT_USER proctira-uat
ensure "$U" MINIO_ROOT_PASSWORD "$(hex 24)"
ensure "$U" S3_ENDPOINT https://minio:9000
# PRC-M542: the MinIO adapter refuses plaintext in production; earlier installs used http.
if grep -q '^S3_ENDPOINT=http://minio:9000$' "$U"; then
  sed -i 's#^S3_ENDPOINT=http://minio:9000$#S3_ENDPOINT=https://minio:9000#' "$U"
fi
ensure "$U" S3_REGION us-east-1
ensure "$U" S3_BUCKET proctira-uat
ensure "$U" S3_FORCE_PATH_STYLE true
ensure "$U" S3_ACCESS_KEY "$(get "$U" MINIO_ROOT_USER)"
ensure "$U" S3_SECRET_KEY "$(get "$U" MINIO_ROOT_PASSWORD)"

# --- Auth ------------------------------------------------------------------------
ensure "$U" JWT_SECRET "$(hex 32)"
ensure "$U" COOKIE_SECRET "$(hex 32)"
ensure "$U" KEYCLOAK_ADMIN uatenv-kc-admin
ensure "$U" KEYCLOAK_ADMIN_PASSWORD "$(hex 24)"
ensure "$U" KEYCLOAK_REALM proctira
ensure "$U" KEYCLOAK_CLIENT_ID proctira-gateway
ensure "$U" KEYCLOAK_CLIENT_SECRET "$(hex 32)"
ensure "$U" KEYCLOAK_ISSUER "$SCHEME://auth.$PLATFORM$PUBLIC_SUFFIX/realms/proctira"
ensure "$U" KEYCLOAK_JWKS_URI http://keycloak:8080/realms/proctira/protocol/openid-connect/certs
ensure "$U" KEYCLOAK_REDIRECT_URI "$SCHEME://api.$PLATFORM$PUBLIC_SUFFIX/api/v1/auth/callback"
ensure "$U" NEXT_PUBLIC_WEB_URL "$SCHEME://sunrise-public-school.$TENANT_BASE$PUBLIC_SUFFIX"

# --- Gateway / web routing ---------------------------------------------------------
ensure "$U" CORS_ORIGINS "$(UATENV_PLATFORM_DOMAIN="$PLATFORM" UATENV_TENANT_BASE_DOMAIN="$TENANT_BASE" \
  UATENV_PUBLIC_SCHEME="$SCHEME" UATENV_PUBLIC_PORT="$PORT" \
  node "$(dirname "${BASH_SOURCE[0]}")/uatenv-render.mjs" cors)"
ensure "$U" TRUSTED_PROXY_CIDRS "$(get "$U" UATENV_SUBNET)"
ensure "$U" RATE_LIMIT_MAX_REQUESTS 600
ensure "$U" TENANT_BASE_DOMAIN "$TENANT_BASE"
ensure "$U" TENANT_FALLBACK_SLUG sunrise-public-school
ensure "$U" ALLOW_SANDBOX_PROVIDERS 1
ensure "$U" PROVIDER_MODE sandbox
ensure "$U" KAFKA_AUTO_CREATE_TOPICS true
ensure "$U" GATEWAY_URL "$SCHEME://api.$PLATFORM$PUBLIC_SUFFIX"
ensure "$U" NEXT_PUBLIC_API_URL "$SCHEME://api.$PLATFORM$PUBLIC_SUFFIX"
ensure "$U" AUTH_SERVICE_URL http://api-gateway:3000

# --- Gateway-only secrets (env_file on api-gateway) ----------------------------------
ensure "$G" AUDIT_CHAIN_HMAC_KEY "$(hex 32)"
ensure "$G" AUDIT_CHAIN_HMAC_KEY_ID uat-primary
ensure "$G" SCHOLARSHIP_DOC_URL_SECRET "$(hex 32)"
ensure "$G" TRANSCRIPT_SIGNING_SECRET "$(hex 32)"
ensure "$G" TRANSCRIPT_SIGNING_KMS_KEY_REF env:TRANSCRIPT_SIGNING_SECRET
ensure "$G" TRANSCRIPT_SIGNING_KEY_ID uat-transcript-1
ensure "$G" SIS_BOARD_EXPORT_SIGNING_SECRET "$(hex 32)"
ensure "$G" REPORT_DOWNLOAD_SIGNING_SECRET "$(hex 32)"
ensure "$G" LMS_FILE_SIGNING_SECRET "$(hex 32)"
ensure "$G" ADMISSIONS_OFFER_SIGNING_SECRET "$(hex 32)"
ensure "$G" REGISTRATION_CHALLENGE_SECRET "$(hex 32)"
ensure "$G" ETL_CONNECTOR_SECRET_KEY "$(openssl rand -base64 32)"
ensure "$G" METRICS_BEARER_TOKEN "$(hex 32)"
ensure "$G" SCIM_TOKEN_PEPPER "$(hex 32)"
ensure "$G" MFA_PRE_TICKET_SECRET "$(hex 32)"
# KMS-backed features run on the documented local stubs until AWS KMS keys exist (pending owner).
ensure "$G" PHI_ENVELOPE_PROVIDER local-stub
ensure "$G" ALLOW_PHI_KMS_STUB 1
ensure "$G" PHI_KMS_STUB_SECRET "$(hex 32)"
ensure "$G" PHI_KMS_KEY_ID alias/proctira-uat-phi-stub
# Random stub root key (the stub otherwise derives a fixed, published root).
ensure "$G" PHI_ENCRYPTION_KEY "$(hex 32)"
ensure "$G" WEBHOOK_SIGNING_KMS_CLIENT local-stub
ensure "$G" ALLOW_WEBHOOK_KMS_STUB 1
ensure "$G" WEBHOOK_SIGNING_KMS_KEY_ID alias/proctira-uat-webhook-stub
ensure "$G" WEBHOOK_SIGNING_KMS_STUB_SECRET "$(hex 32)"
# External providers: sandbox / disabled (Razorpay, MSG91, SES, FCM, Route 53 pending owner).
ensure "$G" MFA_EXPOSE_OTP false
ensure "$G" FEES_STAFF_SANDBOX_PAYMENTS false
ensure "$G" QUEUE_BACKEND rabbitmq
ensure "$G" RABBITMQ_EXCHANGE proctira.events
ensure "$G" REQUIRE_DATABASE 1
ensure "$G" DOCS_PUBLIC 0

# --- Host-only operator URLs (never mounted into a container) --------------------------
ensure "$O" BACKUP_DB_PASSWORD "$(hex 24)"
ensure "$O" BOOTSTRAP_DATABASE_URL "postgresql://postgres:$(get "$U" POSTGRES_PASSWORD)@127.0.0.1:29010/postgres"
ensure "$O" MIGRATOR_DATABASE_URL "postgresql://proctira:$(get "$U" MIGRATOR_PASSWORD)@127.0.0.1:29010/proctira"
ensure "$O" RUNTIME_DATABASE_URL "postgresql://proctira_app:$(get "$U" APP_ROLE_PASSWORD)@127.0.0.1:29010/proctira"
ensure "$O" BACKUP_DATABASE_URL "postgresql://proctira_backup:$(get "$O" BACKUP_DB_PASSWORD)@127.0.0.1:29010/proctira"
ensure "$O" KEYCLOAK_DATABASE_URL "postgresql://keycloak:$(get "$U" KEYCLOAK_DB_PASSWORD)@127.0.0.1:29010/keycloak"
ensure "$O" BACKUP_RETENTION_DAYS 7
ensure "$O" BACKUP_GPG_RECIPIENT proctira-uatenv-backup@localhost
ensure "$O" GNUPGHOME "$UATENV_SEC/gnupg"

# --- Internal TLS for MinIO (private CA; the CA certificate is public) ----------------
TLS_SEC="$UATENV_SEC/tls"
TLS_PUB="$UATENV_RT/generated/tls"
mkdir -p "$TLS_SEC" "$TLS_PUB"
chmod 700 "$TLS_SEC"
chmod 755 "$TLS_PUB"
if [[ ! -f "$TLS_SEC/ca.key" ]]; then
  openssl req -x509 -newkey rsa:3072 -nodes -days 825 -subj '/CN=proctira-uatenv internal CA' \
    -keyout "$TLS_SEC/ca.key" -out "$TLS_PUB/ca.crt" >/dev/null 2>&1
fi
if [[ ! -f "$TLS_SEC/minio.key" ]]; then
  openssl req -newkey rsa:2048 -nodes -subj '/CN=minio' \
    -keyout "$TLS_SEC/minio.key" -out "$TLS_SEC/minio.csr" >/dev/null 2>&1
  printf 'subjectAltName=DNS:minio,DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' >"$TLS_SEC/minio.ext"
  openssl x509 -req -in "$TLS_SEC/minio.csr" -CA "$TLS_PUB/ca.crt" -CAkey "$TLS_SEC/ca.key" \
    -CAcreateserial -days 825 -extfile "$TLS_SEC/minio.ext" -out "$TLS_PUB/minio.crt" >/dev/null 2>&1
  rm -f "$TLS_SEC/minio.csr" "$TLS_SEC/minio.ext"
fi
chmod 600 "$TLS_SEC"/*
chmod 644 "$TLS_PUB/ca.crt" "$TLS_PUB/minio.crt"

chmod 600 "$U" "$G" "$O"
uatenv_log "secrets ready: $(wc -l <"$U") uatenv.env, $(wc -l <"$G") gateway.env, $(wc -l <"$O") ops.env keys (names: uatenv-secrets.sh --names)"
