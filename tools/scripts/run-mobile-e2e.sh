#!/usr/bin/env bash
# Run Flutter integration_test on a connected Android/iOS device or emulator.
# Exits with a clear message when no device is available (common on Cloud Agents).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOBILE="$ROOT/apps/mobile"
TARGET="${1:-integration_test/app_test.dart}"

cd "$MOBILE"

if ! command -v flutter >/dev/null 2>&1; then
  echo "error: flutter is not on PATH" >&2
  exit 1
fi

echo "==> flutter pub get"
flutter pub get

# Prefer an explicitly connected device; fall back to listing.
mapfile -t DEVICES < <(flutter devices --machine 2>/dev/null | python3 -c '
import json,sys
try:
  data=json.load(sys.stdin)
except Exception:
  sys.exit(0)
for d in data:
  # Skip web/desktop for mobile E2E
  if d.get("targetPlatform") in ("android","ios") or d.get("isLocalEmulator"):
    print(d.get("id",""))
' 2>/dev/null || true)

DEVICE_ID=""
if [[ "${#DEVICES[@]}" -gt 0 ]]; then
  DEVICE_ID="${DEVICES[0]}"
fi

if [[ -z "$DEVICE_ID" ]]; then
  # Secondary check via `flutter devices` text output
  if flutter devices 2>/dev/null | grep -Eqi 'android|ios.*(emulator|device)'; then
    :
  else
    cat >&2 <<'EOF'
No Android/iOS device or emulator is connected.

Blocker on this host:
  - Flutter is present. Android cmdline-tools + platform-tools may be
    installed, but no Android Virtual Device (AVD) / physical device / iOS
    simulator is available, so integration_test cannot run here.

To run mobile E2E on a developer machine or CI with an emulator:
  1. Create an AVD (`sdkmanager "system-images;android-34;google_apis;x86_64"`
     then `avdmanager create avd ...`) or connect a USB device.
  2. From apps/mobile: flutter devices
  3. Re-run: tools/scripts/run-mobile-e2e.sh

Unit/widget coverage remains: flutter analyze lib && flutter test
EOF
    exit 2
  fi
fi

echo "==> Running integration_test on ${DEVICE_ID:-default device}: $TARGET"
if [[ -n "$DEVICE_ID" ]]; then
  exec flutter test "$TARGET" -d "$DEVICE_ID"
else
  exec flutter test "$TARGET"
fi
