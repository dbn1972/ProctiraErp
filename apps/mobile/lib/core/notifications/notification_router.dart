/// Maps notification payloads (delivered via FCM data messages) to GoRouter
/// routes, so tapping a push notification deep-links the user straight to the
/// relevant screen.
///
/// Payload contract (matches the Notification_Service):
/// ```json
/// {
///   "type": "ATTENDANCE_THRESHOLD" | "WORKFLOW_APPROVAL" | "REPORT_READY" |
///           "STUDENT_TRANSFER" | "INSTITUTION_UPDATE" | "EXAM_RESULT" | ...,
///   "entityId": "<uuid>"
/// }
/// ```
///
/// Mapping:
/// - `ATTENDANCE_THRESHOLD` → `/attendance/reports`
/// - `WORKFLOW_APPROVAL`    → `/notifications`
/// - `REPORT_READY`         → `/reports/:entityId`
/// - `STUDENT_TRANSFER`     → `/students/:entityId`
/// - `INSTITUTION_UPDATE`   → `/institutions/:entityId`
/// - `EXAM_RESULT`          → `/reports`
/// - default / unknown      → `/notifications`
class NotificationRouter {
  const NotificationRouter();

  /// Entity ids accepted from push payloads: UUIDs or short slugs only.
  /// Anything else (path separators, query strings, oversize values) is
  /// dropped so the payload cannot steer navigation to an arbitrary path.
  static final RegExp _entityIdPattern = RegExp(
    r'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$',
  );

  /// Returns a URL-encoded entity id, or `null` when [raw] is missing or
  /// malformed (PRC-L006).
  static String? safeEntityId(Object? raw) {
    if (raw is! String) {
      return null;
    }
    final String trimmed = raw.trim();
    if (!_entityIdPattern.hasMatch(trimmed)) {
      return null;
    }
    return Uri.encodeComponent(trimmed);
  }

  /// Pure function that maps the notification [payload] to a GoRouter path.
  String routeFor(Map<String, dynamic>? payload) => routeForPayload(payload);

  /// Pure top-level helper, exported as [NotificationRouter.routeForPayload]
  /// for tests and callers that don't have an instance handy.
  static String routeForPayload(Map<String, dynamic>? payload) {
    if (payload == null || payload.isEmpty) {
      return '/notifications';
    }
    final Object? rawType = payload['type'];
    if (rawType is! String || rawType.isEmpty) {
      return '/notifications';
    }
    final String? entityId = safeEntityId(payload['entityId']);

    switch (rawType) {
      case 'ATTENDANCE_THRESHOLD':
        return '/attendance/reports';
      case 'WORKFLOW_APPROVAL':
        return '/notifications';
      case 'REPORT_READY':
        return entityId != null ? '/reports/$entityId' : '/reports';
      case 'STUDENT_TRANSFER':
        return entityId != null ? '/students/$entityId' : '/students';
      case 'INSTITUTION_UPDATE':
        return entityId != null ? '/institutions/$entityId' : '/institutions';
      case 'EXAM_RESULT':
        return '/reports';
      default:
        return '/notifications';
    }
  }
}

/// Top-level shortcut so tests / non-OOP callers can avoid constructing a
/// router instance.
String routeForPayload(Map<String, dynamic>? payload) =>
    NotificationRouter.routeForPayload(payload);
