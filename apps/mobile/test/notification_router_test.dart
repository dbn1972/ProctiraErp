import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/notifications/notification_router.dart';

void main() {
  group('NotificationRouter.routeForPayload', () {
    test('ATTENDANCE_THRESHOLD maps to /attendance/reports', () {
      expect(
        routeForPayload(<String, dynamic>{
          'type': 'ATTENDANCE_THRESHOLD',
          'entityId': 'ent-1',
        }),
        '/attendance/reports',
      );
    });

    test('WORKFLOW_APPROVAL maps to /workflows/approvals', () {
      expect(
        routeForPayload(<String, dynamic>{
          'type': 'WORKFLOW_APPROVAL',
          'entityId': 'wf-1',
        }),
        '/workflows/approvals',
      );
    });

    test('REPORT_READY with entityId maps to /reports/:entityId', () {
      expect(
        routeForPayload(<String, dynamic>{
          'type': 'REPORT_READY',
          'entityId': 'rep-1',
        }),
        '/reports/rep-1',
      );
    });

    test('REPORT_READY without entityId maps to /reports', () {
      expect(
        routeForPayload(<String, dynamic>{
          'type': 'REPORT_READY',
        }),
        '/reports',
      );
    });

    test('STUDENT_TRANSFER with entityId maps to /students/:entityId', () {
      expect(
        routeForPayload(<String, dynamic>{
          'type': 'STUDENT_TRANSFER',
          'entityId': 'stu-1',
        }),
        '/students/stu-1',
      );
    });

    test('STUDENT_TRANSFER without entityId maps to /students', () {
      expect(
        routeForPayload(<String, dynamic>{
          'type': 'STUDENT_TRANSFER',
        }),
        '/students',
      );
    });

    test('INSTITUTION_UPDATE with entityId maps to /institutions/:entityId',
        () {
      expect(
        routeForPayload(<String, dynamic>{
          'type': 'INSTITUTION_UPDATE',
          'entityId': 'inst-1',
        }),
        '/institutions/inst-1',
      );
    });

    test('INSTITUTION_UPDATE without entityId maps to /institutions', () {
      expect(
        routeForPayload(<String, dynamic>{
          'type': 'INSTITUTION_UPDATE',
        }),
        '/institutions',
      );
    });

    test('EXAM_RESULT maps to /reports', () {
      expect(
        routeForPayload(<String, dynamic>{
          'type': 'EXAM_RESULT',
          'entityId': 'exam-1',
        }),
        '/reports',
      );
    });

    test('unknown type falls back to /notifications', () {
      expect(
        routeForPayload(<String, dynamic>{'type': 'SOMETHING_NEW'}),
        '/notifications',
      );
    });

    test('null payload falls back to /notifications', () {
      expect(routeForPayload(null), '/notifications');
    });

    test('empty payload falls back to /notifications', () {
      expect(routeForPayload(<String, dynamic>{}), '/notifications');
    });

    test('non-string type falls back to /notifications', () {
      expect(
        routeForPayload(<String, dynamic>{'type': 42}),
        '/notifications',
      );
    });

    test('NotificationRouter.routeFor is consistent with the helper', () {
      const NotificationRouter router = NotificationRouter();
      const Map<String, dynamic> payload = <String, dynamic>{
        'type': 'ATTENDANCE_THRESHOLD',
      };
      expect(router.routeFor(payload), routeForPayload(payload));
    });

    test('non-string entityId is ignored gracefully', () {
      expect(
        routeForPayload(<String, dynamic>{
          'type': 'REPORT_READY',
          'entityId': 123,
        }),
        '/reports',
      );
    });
  });
}
