# proctira_mobile

ProctiraERP Unified Platform mobile application. Flutter app that targets
Android, iOS, and (for development convenience) desktop.

## Getting started

```sh
flutter pub get
flutter run
```

## Push notifications (Firebase Cloud Messaging)

The app integrates with [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging)
for push notifications. The runtime initialiser
(`lib/core/notifications/fcm_service.dart`) wraps `Firebase.initializeApp`
in a `try/catch` so the app boots fine on devices that have not been
configured with Firebase credentials yet — push notifications simply
no-op until a config file is added.

When Firebase initialises successfully, `FcmService` requests permission,
retrieves the FCM device token, and registers it with the backend via
`POST /api/v1/notifications/devices` (including `onTokenRefresh`).

### Example config files

Checked-in placeholders (safe to commit):

| Platform | Example | Real destination |
|----------|---------|------------------|
| Android  | `android/app/google-services.json.example` | `android/app/google-services.json` |
| iOS      | `ios/Runner/GoogleService-Info.plist.example` | `ios/Runner/GoogleService-Info.plist` |

### Placing real files on EC3 / CI from secrets

1. Create (or open) the Firebase project for your environment.
2. Register the Android app (`com.proctira.mobile`) and iOS bundle
   (`com.proctira.mobile`) inside the Firebase console.
3. Download the platform configuration files into a secrets store / vault
   path on the build host (never commit them).
4. On EC3 or in CI, export the paths and run the helper script:

```sh
export FCM_ANDROID_GOOGLE_SERVICES_JSON=/secure/fcm/google-services.json
export FCM_IOS_GOOGLE_SERVICE_INFO_PLIST=/secure/fcm/GoogleService-Info.plist
./scripts/apply-fcm-secrets.sh
```

Or copy manually:

| Platform | File                          | Destination                                      |
|----------|-------------------------------|--------------------------------------------------|
| Android  | `google-services.json`        | `apps/mobile/android/app/google-services.json`   |
| iOS      | `GoogleService-Info.plist`    | `apps/mobile/ios/Runner/GoogleService-Info.plist`|

5. **Do not commit these files.** They contain project-specific keys.
   They are listed in `.gitignore` (the platform-specific `.gitignore`
   files at `android/.gitignore` and `ios/.gitignore` already exclude
   the configuration filenames). Keep them in your local checkout only,
   or distribute them via a secrets manager / CI vault.

6. (Optional) Configure the APNs key inside Firebase so iOS devices can
   receive push notifications.

The notification subsystem is composed of:

- `core/notifications/fcm_service.dart` — initialises Firebase, requests
  permission, registers the device token via
  `POST /api/v1/notifications/devices`, and forwards messages to local
  notifications + the deep-link router.
- `core/notifications/local_notifications.dart` — wraps
  `flutter_local_notifications` for foreground display.
- `core/notifications/notification_router.dart` — pure function mapping
  payload `type` values to GoRouter paths
  (`ATTENDANCE_THRESHOLD` → `/attendance/reports`, `WORKFLOW_APPROVAL` →
  `/workflows/approvals`, `REPORT_READY` → `/reports`).

## Tests

```sh
flutter analyze lib
flutter test
```

Device / emulator E2E (`integration_test/`) needs an Android SDK + emulator
or an iOS simulator. This Cloud Agent image has Flutter + Chrome but **no
Android toolchain**, so run those suites on a developer machine:

```sh
# helper (exits 2 with a clear message when no device is connected)
../../tools/scripts/run-mobile-e2e.sh

# or directly:
flutter test integration_test
```

Keycloak login uses `POST /api/v1/auth/login` (password fallback
`/api/v1/auth/password`) via `AuthRepository`. Biometric unlock refreshes
tokens with `POST /api/v1/auth/refresh`.
