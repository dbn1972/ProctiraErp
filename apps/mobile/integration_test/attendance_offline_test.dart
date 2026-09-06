import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:proctira_mobile/core/sync/sync_models.dart';
import 'package:sqflite/sqflite.dart';

import 'helpers/test_setup.dart';

/// Integration test: Mark attendance offline → verify queued for sync.
///
/// Flow:
/// 1. Bootstrap the harness OFFLINE with a tenant + authenticated user.
/// 2. Seed the local student roster cache.
/// 3. Navigate to the attendance screen.
/// 4. Load the roster and mark a student as PRESENT.
/// 5. Assert the attendance record is persisted to `attendance_offline`
///    with `synced = 0`.
/// 6. Assert a corresponding `pending_sync` row exists with operation=create.
/// 7. Verify the sync dispatcher was NOT invoked (device is offline).
///
/// This validates:
/// - Offline-first attendance marking persists locally.
/// - The sync queue correctly captures the pending operation.
/// - No network calls are attempted while offline.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'mark attendance offline → record persisted → queued for sync',
    (WidgetTester tester) async {
      final JourneyHarness harness = await bootstrapTestApp(
        tenantId: 'tenant-offline',
        tenantDisplayName: 'Offline School',
        startsOnline: false,
      );
      addTearDown(harness.dispose);

      // Authenticate the user so the router allows access.
      await harness.markAuthenticated(userId: 'teacher-offline-1');

      // Seed the local student roster so the attendance screen can load
      // without hitting the network.
      final Database raw = await harness.database.database;
      await raw.insert('students_cache', <String, Object?>{
        'id': 'stu-offline-1',
        'tenant_id': 'tenant-offline',
        'institution_id': 'inst-offline-1',
        'full_name': 'Grace Hopper',
        'national_id': 'GH001',
        'grade': '10',
        'class_name': 'Section A',
        'payload':
            '{"id":"stu-offline-1","firstName":"Grace","lastName":"Hopper",'
            '"institutionId":"inst-offline-1",'
            '"createdAt":"2026-01-01T00:00:00Z",'
            '"updatedAt":"2026-01-01T00:00:00Z"}',
        'updated_at': 1,
      });

      await pumpJourneyApp(tester);

      // Navigate to the attendance screen.
      goJourney('/attendance');
      await tester.pumpAndSettle();

      // Enter institution ID and load the roster.
      final Finder institutionField = find.widgetWithText(
        TextField,
        'Institution ID',
      );
      expect(
        institutionField,
        findsOneWidget,
        reason: 'Attendance screen should have an Institution ID field',
      );
      await tester.enterText(institutionField, 'inst-offline-1');
      await tester.pumpAndSettle();

      // Tap "Load roster" button.
      final Finder loadButton =
          find.widgetWithText(FilledButton, 'Load roster');
      expect(loadButton, findsOneWidget);
      await tester.tap(loadButton);
      await tester.pumpAndSettle();

      // Verify the seeded student appears in the roster.
      expect(
        find.text('Grace Hopper'),
        findsOneWidget,
        reason: 'Seeded student should appear in the roster',
      );

      // Mark the student as PRESENT.
      final Finder presentChip =
          find.widgetWithText(ChoiceChip, 'PRESENT');
      expect(presentChip, findsOneWidget);
      await tester.ensureVisible(presentChip);
      await tester.tap(presentChip);
      await tester.pumpAndSettle();

      // --- Verify local persistence ---

      // 1. Check attendance_offline table has the record with synced=0.
      final List<Map<String, Object?>> attendanceRows =
          await raw.query('attendance_offline');
      expect(
        attendanceRows,
        hasLength(1),
        reason: 'One attendance record should be persisted offline',
      );
      expect(attendanceRows.first['status'], 'PRESENT');
      expect(attendanceRows.first['student_id'], 'stu-offline-1');
      expect(attendanceRows.first['institution_id'], 'inst-offline-1');
      expect(
        attendanceRows.first['synced'],
        0,
        reason: 'Record should be marked as unsynced',
      );

      // 2. Check pending_sync table has a corresponding create operation.
      final List<Map<String, Object?>> syncRows =
          await raw.query('pending_sync');
      expect(
        syncRows,
        hasLength(1),
        reason: 'One pending sync operation should be queued',
      );
      expect(syncRows.first['entity_type'], 'attendance');
      expect(syncRows.first['operation'], 'create');
      expect(syncRows.first['tenant_id'], 'tenant-offline');

      // 3. Verify the sync dispatcher was NOT invoked while offline.
      expect(
        harness.recordingDispatcher.wasInvoked,
        isFalse,
        reason: 'Sync dispatcher should not run while device is offline',
      );
    },
  );

  testWidgets(
    'queued attendance syncs when connectivity is restored',
    (WidgetTester tester) async {
      final JourneyHarness harness = await bootstrapTestApp(
        tenantId: 'tenant-sync',
        tenantDisplayName: 'Sync School',
        startsOnline: false,
      );
      addTearDown(harness.dispose);

      await harness.markAuthenticated(userId: 'teacher-sync-1');

      // Seed student and attendance data as if it was marked offline.
      final Database raw = await harness.database.database;
      await raw.insert('students_cache', <String, Object?>{
        'id': 'stu-sync-1',
        'tenant_id': 'tenant-sync',
        'institution_id': 'inst-sync-1',
        'full_name': 'Alan Turing',
        'national_id': 'AT001',
        'grade': '11',
        'class_name': 'Section B',
        'payload':
            '{"id":"stu-sync-1","firstName":"Alan","lastName":"Turing",'
            '"institutionId":"inst-sync-1",'
            '"createdAt":"2026-01-01T00:00:00Z",'
            '"updatedAt":"2026-01-01T00:00:00Z"}',
        'updated_at': 1,
      });

      await pumpJourneyApp(tester);

      // Navigate to attendance and mark present.
      goJourney('/attendance');
      await tester.pumpAndSettle();

      await tester.enterText(
        find.widgetWithText(TextField, 'Institution ID'),
        'inst-sync-1',
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Load roster'));
      await tester.pumpAndSettle();

      expect(find.text('Alan Turing'), findsOneWidget);
      await tester.ensureVisible(
          find.widgetWithText(ChoiceChip, 'PRESENT'));
      await tester.tap(find.widgetWithText(ChoiceChip, 'PRESENT'));
      await tester.pumpAndSettle();

      // Confirm queued.
      expect(harness.recordingDispatcher.wasInvoked, isFalse);

      // Restore connectivity — the sync engine should flush pending ops.
      harness.connectivity.emit(true);
      await _pumpUntilDispatched(tester, harness);

      // Verify the dispatcher received the attendance create operation.
      expect(harness.recordingDispatcher.wasInvoked, isTrue);
      final PendingSyncRow dispatched =
          harness.recordingDispatcher.received.first;
      expect(dispatched.entityType, SyncEntityType.attendance);
      expect(dispatched.operation, SyncOperation.create);
      expect(dispatched.payload['studentId'], 'stu-sync-1');
      expect(dispatched.payload['status'], 'PRESENT');
    },
  );
}

/// Pump frames until the recording dispatcher is invoked or timeout.
Future<void> _pumpUntilDispatched(
  WidgetTester tester,
  JourneyHarness harness, {
  Duration timeout = const Duration(seconds: 5),
}) async {
  final DateTime deadline = DateTime.now().add(timeout);
  while (!harness.recordingDispatcher.wasInvoked) {
    if (DateTime.now().isAfter(deadline)) {
      fail(
        'Sync dispatcher was not invoked within ${timeout.inSeconds}s '
        'after connectivity was restored',
      );
    }
    await tester.pump(const Duration(milliseconds: 50));
  }
}
