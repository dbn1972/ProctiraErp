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

To enable push notifications on a real device:

1. Create (or open) the Firebase project for your environment.
2. Register the Android app (`com.proctira.mobile`) and iOS bundle
   (`com.proctira.mobile`) inside the Firebase console.
3. Download the platform configuration files and drop them into the
   following locations:

   | Platform | File                       | Destination                                       |
   | -------- | -------------------------- | ------------------------------------------------- |
   | Android  | `google-services.json`     | `apps/mobile/android/app/google-services.json`    |
   | iOS      | `GoogleService-Info.plist` | `apps/mobile/ios/Runner/GoogleService-Info.plist` |

4. **Do not commit these files.** They contain project-specific keys.
   They are listed in `.gitignore` (the platform-specific `.gitignore`
   files at `android/.gitignore` and `ios/.gitignore` already exclude
   the configuration filenames). Keep them in your local checkout only,
   or distribute them via a secrets manager / CI vault.

5. (Optional) Configure the APNs key inside Firebase so iOS devices can
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
  `/notifications`, `REPORT_READY` → `/reports`).

## Tests

```sh
flutter analyze
flutter test
```
