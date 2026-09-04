import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:integration_test/integration_test.dart';
import 'package:proctira_mobile/core/sync/sync_engine.dart';
import 'package:proctira_mobile/core/sync/sync_models.dart';
import 'package:sqflite/sqflite.dart';

import 'helpers/test_setup.dart';

/// Covers the offline-first attendance journey:
/// login → mark attendance offline → sync when online.
///
/// Flow:
/// 1. Bootstrap the harness offline with a tenant + an authenticated user.
/// 2. Drive the attendance screen, load the cached roster, mark a student as
///    PRESENT.
/// 3. Assert the row is persisted to `attendance_offline` (synced=0) and a
///    matching op is parked in `pending_sync`.
/// 4. Flip [FakeConnectivityMonitor] to online and assert the recording
///    dispatcher is invoked at least once with the queued row, proving
///    flushPending was triggered.
///
/// Validates: Requirements 9.1
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'login → mark attendance offline → sync engine flushes when online',
    (WidgetTester tester) async {
      final JourneyHarness harness = await bootstrapTestApp(
        tenantId: 'tenant-a',
        tenantDisplayName: 'Tenant A',
      );
      addTearDown(harness.dispose);

      // Pretend the user already authenticated; the redirect rules then take
      // them to `/`.
      await harness.markAuthenticated(userId: 'teacher-1');

      // Seed the local roster (one student) before the screen pumps so the
      // cache-first repository can populate without hitting the API.
      final Database raw = await harness.database.database;
      await raw.insert('students_cache', <String, Object?>{
        'id': 'stu-1',
        'tenant_id': 'tenant-a',
        'institution_id': 'inst-1',
        'full_name': 'Ada Lovelace',
        'national_id': 'A1',
        'grade': null,
        'class_name': null,
        'payload':
            '{"id":"stu-1","firstName":"Ada","lastName":"Lovelace","institutionId":"inst-1","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}',
        'updated_at': 1,
      });

      await pumpJourneyApp(tester);

      // GoRouter redirects past `/login` because the user is authenticated;
      // navigate directly to `/attendance` to skip the home tile dance.
      _go(tester, '/attendance');
      await tester.pumpAndSettle();

      // Type the institution id and tap "Load roster".
      final Finder institutionField = find.widgetWithText(
        TextField,
        'Institution ID',
      );
      expect(institutionField, findsOneWidget);
      await tester.enterText(institutionField, 'inst-1');
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Load roster'));
      await tester.pumpAndSettle();

      // Assert the seeded student row is present.
      expect(find.text('Ada Lovelace'), findsOneWidget);

      // Tap the "PRESENT" choice chip on the roster row.
      await tester.ensureVisible(find.widgetWithText(ChoiceChip, 'PRESENT'));
      await tester.tap(find.widgetWithText(ChoiceChip, 'PRESENT'));
      await tester.pumpAndSettle();

      // The attendance row is now in the offline cache, unsynced.
      final List<Map<String, Object?>> attendance =
          await raw.query('attendance_offline');
      expect(attendance, hasLength(1));
      expect(attendance.first['status'], 'PRESENT');
      expect(attendance.first['student_id'], 'stu-1');
      expect(attendance.first['synced'], 0);

      // A pending_sync row tracks the create.
      final SyncEngine engine = harness.syncEngine;
      final List<PendingSyncRow> queue = await engine.getPending();
      expect(queue, hasLength(1));
      expect(queue.first.entityType, SyncEntityType.attendance);
      expect(queue.first.operation, SyncOperation.create);
      expect(queue.first.payload['status'], 'PRESENT');

      // While offline the recording dispatcher must NOT have been invoked.
      expect(
        harness.recordingDispatcher.wasInvoked,
        isFalse,
        reason: 'Sync dispatcher should not run while offline',
      );

      // Flip connectivity to online — the engine listens to the stream and
      // calls flushPending. Pump until the dispatcher has been invoked.
      harness.connectivity.emit(true);
      await _pumpUntilDispatched(tester, harness);

      expect(harness.recordingDispatcher.wasInvoked, isTrue);
      final PendingSyncRow dispatched =
          harness.recordingDispatcher.received.first;
      expect(dispatched.entityType, SyncEntityType.attendance);
      expect(dispatched.operation, SyncOperation.create);
      expect(dispatched.payload['studentId'], 'stu-1');
      expect(dispatched.payload['status'], 'PRESENT');
    },
  );
}

/// Reach into the running app to grab the GoRouter instance and navigate
/// without hunting for invisible navigation tiles.
void _go(WidgetTester tester, String location) {
  final BuildContext context =
      tester.element(find.byType(MaterialApp).first);
  GoRouter.of(context).go(location);
}

/// Repeatedly pump frames until [RecordingSyncDispatcher.wasInvoked] flips,
/// or fail the test if it doesn't happen within [timeout].
Future<void> _pumpUntilDispatched(
  WidgetTester tester,
  JourneyHarness harness, {
  Duration timeout = const Duration(seconds: 5),
}) async {
  final DateTime deadline = DateTime.now().add(timeout);
  while (!harness.recordingDispatcher.wasInvoked) {
    if (DateTime.now().isAfter(deadline)) {
      fail('Sync dispatcher was not invoked within ${timeout.inSeconds}s');
    }
    await tester.pump(const Duration(milliseconds: 50));
  }
}
