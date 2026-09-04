/// Aggregates every journey test under one entrypoint so the suite can be
/// invoked with `flutter test integration_test/app_test.dart`. Each journey
/// lives in its own file (and can be run individually); this file simply
/// re-runs them in one process.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'journey_attendance_offline_sync_test.dart' as attendance;
import 'journey_notification_deep_link_test.dart' as notifications;
import 'journey_student_enrollment_navigation_test.dart' as students;
import 'journey_tenant_isolation_test.dart' as tenants;
import 'journey_thin_screens_test.dart' as thin;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group('Mobile journey: offline attendance + sync', attendance.main);
  group('Mobile journey: students → enrollment history', students.main);
  group('Mobile journey: notification deep-link', notifications.main);
  group('Mobile journey: tenant isolation', tenants.main);
  group('Mobile journey: thin screens residuals', thin.main);
}
