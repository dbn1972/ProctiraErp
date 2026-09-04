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
/// - `WORKFLOW_APPROVAL`    → `/workflows/approvals`
/// - `REPORT_READY`         → `/reports/:entityId`
/// - `STUDENT_TRANSFER`     → `/students/:entityId`
/// - `INSTITUTION_UPDATE`   → `/institutions/:entityId`
/// - `EXAM_RESULT`          → `/reports`
/// - default / unknown      → `/notifications`
class NotificationRouter {
  const NotificationRouter();

  /// Pure function that maps the notification [payload] to a GoRouter path.
  String routeFor(Map<String, dynamic>? payload) =>
      routeForPayload(payload);

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
    final String? entityId =
        payload['entityId'] is String ? payload['entityId'] as String : null;

    switch (rawType) {
      case 'ATTENDANCE_THRESHOLD':
        return '/attendance/reports';
      case 'WORKFLOW_APPROVAL':
        return '/workflows/approvals';
      case 'REPORT_READY':
        return entityId != null ? '/reports/$entityId' : '/reports';
      case 'STUDENT_TRANSFER':
        return entityId != null ? '/students/$entityId' : '/students';
      case 'INSTITUTION_UPDATE':
        return entityId != null
            ? '/institutions/$entityId'
            : '/institutions';
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
