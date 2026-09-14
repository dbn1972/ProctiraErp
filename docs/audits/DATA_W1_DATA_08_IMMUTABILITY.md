# W1-DATA-08 — Audit archive immutability + transcript authenticity

## Closed
- `audit_log_archive` append-only trigger + REVOKE UPDATE/DELETE/TRUNCATE/TRIGGER from `proctira_app`
- `transcript_issuances.signature_hmac` first-class column
- INSERT guard requiring checksum_sha256 + signature_hmac (64 hex) when status=`ISSUED`
- Gradebook issue path persists `signatureHmac` alongside checksum

## Residual
- Historical ISSUED rows without signature remain until backfilled (CHECK is NOT VALID)
- Offline verification UI / public QR verify endpoint not in this slice
