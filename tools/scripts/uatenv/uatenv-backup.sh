#!/usr/bin/env bash
# Nightly UAT backup (systemd user timer proctira-uatenv-backup.timer, 02:30).
#   - proctira database: tools/scripts/pg-backup.sh as proctira_backup
#     (BYPASSRLS + pg_read_all_data), gpg-encrypted (BACKUP_ENCRYPT=1)
#   - keycloak database: pg_dump as its owner role, gpg-encrypted
# Both are kept BACKUP_RETENTION_DAYS (7) days in backups/ (mode 700).
# Passwords reach pg_dump/psql through PGPASSWORD, never argv.
#   uatenv-backup.sh [--init-key]   (--init-key: create the gpg key if absent, then exit)
set -euo pipefail
# shellcheck source=uatenv-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/uatenv-lib.sh"
umask 077

load_env_file "$UATENV_SEC/ops.env"
export GNUPGHOME
mkdir -p "$UATENV_BACKUPS"
chmod 700 "$UATENV_BACKUPS"
uatenv_gnupg_tools

init_key() {
  if gpg --batch --list-keys "$BACKUP_GPG_RECIPIENT" >/dev/null 2>&1; then
    uatenv_log "backup gpg key present ($BACKUP_GPG_RECIPIENT)"
    return 0
  fi
  # No passphrase: the nightly job runs unattended (documented limitation:
  # key and dumps share this host until an offsite copy exists).
  gpg --batch --pinentry-mode loopback --passphrase '' \
    --quick-generate-key "$BACKUP_GPG_RECIPIENT" default default never >/dev/null 2>&1
  uatenv_log "backup gpg key created in secrets/gnupg ($BACKUP_GPG_RECIPIENT)"
}

if [[ "${1:-}" == "--init-key" ]]; then
  init_key
  exit 0
fi
init_key

REL="$(uatenv_release_dir)"

# A user unit cannot order itself after the system docker.service, so the
# boot catch-up run (Persistent=true) may start before Postgres is published.
# Wait up to UATENV_BACKUP_WAIT seconds (default 600) for it to accept connections.
pg_wait_start=$SECONDS
until pg_isready -q -h 127.0.0.1 -p 29010 -t 5; do
  if ((SECONDS - pg_wait_start > ${UATENV_BACKUP_WAIT:-600})); then
    uatenv_die "postgres on 127.0.0.1:29010 not ready after ${UATENV_BACKUP_WAIT:-600}s; backup not taken"
  fi
  uatenv_log "postgres not ready yet; retrying in 15s"
  sleep 15
done

TS="$(date -u +%Y%m%dT%H%M%SZ)"

uatenv_log "proctira database -> pg-backup.sh"
DATABASE_URL="$(uatenv_url_without_password "$BACKUP_DATABASE_URL")" \
  PGPASSWORD="$(uatenv_url_password "$BACKUP_DATABASE_URL")" \
  BACKUP_DIR="$UATENV_BACKUPS" \
  BACKUP_RETENTION_DAYS="$BACKUP_RETENTION_DAYS" \
  BACKUP_GPG_RECIPIENT="$BACKUP_GPG_RECIPIENT" \
  BACKUP_ENCRYPT=1 \
  bash "$REL/tools/scripts/pg-backup.sh" "$UATENV_BACKUPS/proctira-$TS.dump"

uatenv_log "keycloak database -> pg_dump"
KC_OUT="$UATENV_BACKUPS/keycloak-$TS.dump"
PGPASSWORD="$(uatenv_url_password "$KEYCLOAK_DATABASE_URL")" \
  pg_dump --dbname="$(uatenv_url_without_password "$KEYCLOAK_DATABASE_URL")" \
  --format=custom --compress=9 --no-owner --file="$KC_OUT"
gpg --batch --yes --trust-model always -r "$BACKUP_GPG_RECIPIENT" -o "$KC_OUT.gpg" --encrypt "$KC_OUT"
rm -f "$KC_OUT"
find "$UATENV_BACKUPS" -maxdepth 1 -type f -name 'keycloak-*.dump.gpg' -mtime +"$BACKUP_RETENTION_DAYS" -print -delete

chmod 600 "$UATENV_BACKUPS"/*.gpg
uatenv_log "backup done: $(ls -1 "$UATENV_BACKUPS" | wc -l) artifact(s) in backups/"
