#!/usr/bin/env bash
# W1-OPS-04 — encrypt / decrypt / offsite sync helpers for pg-backup.sh &
# pg-restore.sh. Never commit real keys; operators supply env vars / secrets.
set -euo pipefail

# Encrypt a plaintext dump when BACKUP_AGE_RECIPIENT, BACKUP_GPG_RECIPIENT, or
# BACKUP_ENCRYPT=1 is set. Removes the plaintext file on success.
# Prints the path of the artifact to keep (encrypted or original).
backup_encrypt_if_configured() {
  local plain="${1:?plain dump path required}"

  if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
    command -v age >/dev/null 2>&1 || {
      echo "ERROR: age is required when BACKUP_AGE_RECIPIENT is set" >&2
      exit 1
    }
    local encrypted="${plain}.age"
    echo "==> age encrypt → ${encrypted}" >&2
    age -e -r "$BACKUP_AGE_RECIPIENT" -o "$encrypted" "$plain"
    rm -f "$plain"
    echo "$encrypted"
    return 0
  fi

  if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
    command -v gpg >/dev/null 2>&1 || {
      echo "ERROR: gpg is required when BACKUP_GPG_RECIPIENT is set" >&2
      exit 1
    }
    local encrypted="${plain}.gpg"
    echo "==> gpg encrypt → ${encrypted}" >&2
    gpg --batch --yes --trust-model always \
      --encrypt -r "$BACKUP_GPG_RECIPIENT" -o "$encrypted" "$plain"
    rm -f "$plain"
    echo "$encrypted"
    return 0
  fi

  if [[ "${BACKUP_ENCRYPT:-}" == "1" || "${BACKUP_ENCRYPT:-}" == "true" ]]; then
    echo "ERROR: BACKUP_ENCRYPT is set but neither BACKUP_AGE_RECIPIENT nor BACKUP_GPG_RECIPIENT is configured" >&2
    exit 1
  fi

  echo "$plain"
}

# Decrypt age/gpg artifacts for pg_restore. Prints a path suitable for
# pg_restore — either the original file or a temp decrypted dump.
backup_decrypt_if_needed() {
  local artifact="${1:?artifact path required}"

  case "$artifact" in
    *.age)
      command -v age >/dev/null 2>&1 || {
        echo "ERROR: age is required to decrypt ${artifact}" >&2
        exit 1
      }
      local tmp
      tmp="$(mktemp "${TMPDIR:-/tmp}/proctira-restore.XXXXXX.dump")"
      echo "==> age decrypt ← ${artifact}" >&2
      if [[ -n "${BACKUP_AGE_IDENTITY_FILE:-}" ]]; then
        age -d -i "$BACKUP_AGE_IDENTITY_FILE" -o "$tmp" "$artifact"
      elif [[ -n "${BACKUP_AGE_IDENTITY:-}" ]]; then
        printf '%s\n' "$BACKUP_AGE_IDENTITY" | age -d -i /dev/stdin -o "$tmp" "$artifact"
      else
        age -d -o "$tmp" "$artifact"
      fi
      echo "$tmp"
      ;;
    *.gpg)
      command -v gpg >/dev/null 2>&1 || {
        echo "ERROR: gpg is required to decrypt ${artifact}" >&2
        exit 1
      }
      local tmp
      tmp="$(mktemp "${TMPDIR:-/tmp}/proctira-restore.XXXXXX.dump")"
      echo "==> gpg decrypt ← ${artifact}" >&2
      gpg --batch --yes --decrypt -o "$tmp" "$artifact"
      echo "$tmp"
      ;;
    *)
      echo "$artifact"
      ;;
  esac
}

# Push an encrypted artifact to offsite storage when BACKUP_OFFSITE_URI is set.
# Supports s3:// URIs via aws-cli with optional SSE (BACKUP_S3_SSE, default AES256).
backup_offsite_sync() {
  local file="${1:?file to sync required}"
  local uri="${BACKUP_OFFSITE_URI:-}"

  [[ -n "$uri" ]] || return 0

  local dest="${uri%/}/$(basename "$file")"
  echo "==> offsite sync → ${dest}" >&2

  case "$dest" in
    s3://*)
      command -v aws >/dev/null 2>&1 || {
        echo "ERROR: aws CLI is required for s3:// BACKUP_OFFSITE_URI" >&2
        exit 1
      }
      local -a sse_args=()
      if [[ -n "${BACKUP_S3_SSE:-}" ]]; then
        sse_args=(--server-side-encryption "$BACKUP_S3_SSE")
        if [[ "${BACKUP_S3_SSE}" == "aws:kms" && -n "${BACKUP_S3_SSE_KMS_KEY_ID:-}" ]]; then
          sse_args+=(--sse-kms-key-id "$BACKUP_S3_SSE_KMS_KEY_ID")
        fi
      fi
      aws s3 cp "$file" "$dest" "${sse_args[@]}"
      ;;
    *)
      echo "ERROR: unsupported BACKUP_OFFSITE_URI scheme (use s3://bucket/prefix/): ${uri}" >&2
      exit 1
      ;;
  esac
}
