#!/usr/bin/env bash
# Copy Firebase / FCM platform config files from secret paths into the mobile app.
#
# Expected env vars (file paths to real secrets — never commit the targets):
#   FCM_ANDROID_GOOGLE_SERVICES_JSON  → apps/mobile/android/app/google-services.json
#   FCM_IOS_GOOGLE_SERVICE_INFO_PLIST → apps/mobile/ios/Runner/GoogleService-Info.plist
#
# Usage (EC3 / CI):
#   export FCM_ANDROID_GOOGLE_SERVICES_JSON=/secure/fcm/google-services.json
#   export FCM_IOS_GOOGLE_SERVICE_INFO_PLIST=/secure/fcm/GoogleService-Info.plist
#   ./scripts/apply-fcm-secrets.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ANDROID_DEST="$ROOT/apps/mobile/android/app/google-services.json"
IOS_DEST="$ROOT/apps/mobile/ios/Runner/GoogleService-Info.plist"

copied=0

if [[ -n "${FCM_ANDROID_GOOGLE_SERVICES_JSON:-}" ]]; then
  if [[ ! -f "$FCM_ANDROID_GOOGLE_SERVICES_JSON" ]]; then
    echo "error: FCM_ANDROID_GOOGLE_SERVICES_JSON does not exist: $FCM_ANDROID_GOOGLE_SERVICES_JSON" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$ANDROID_DEST")"
  cp -f "$FCM_ANDROID_GOOGLE_SERVICES_JSON" "$ANDROID_DEST"
  echo "Wrote $ANDROID_DEST"
  copied=1
fi

if [[ -n "${FCM_IOS_GOOGLE_SERVICE_INFO_PLIST:-}" ]]; then
  if [[ ! -f "$FCM_IOS_GOOGLE_SERVICE_INFO_PLIST" ]]; then
    echo "error: FCM_IOS_GOOGLE_SERVICE_INFO_PLIST does not exist: $FCM_IOS_GOOGLE_SERVICE_INFO_PLIST" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$IOS_DEST")"
  cp -f "$FCM_IOS_GOOGLE_SERVICE_INFO_PLIST" "$IOS_DEST"
  echo "Wrote $IOS_DEST"
  copied=1
fi

if [[ "$copied" -eq 0 ]]; then
  echo "No FCM secret paths set."
  echo "Set FCM_ANDROID_GOOGLE_SERVICES_JSON and/or FCM_IOS_GOOGLE_SERVICE_INFO_PLIST,"
  echo "or copy the *.example files manually and fill in Firebase console values."
  exit 1
fi
