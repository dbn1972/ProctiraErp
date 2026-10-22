import 'package:flutter/material.dart';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:proctira_mobile/core/di/injector.dart';
import 'package:proctira_mobile/core/sync/sync_dispatcher.dart';
import 'package:proctira_mobile/core/sync/sync_engine.dart';
import 'package:proctira_mobile/core/sync/sync_models.dart';
import 'package:proctira_mobile/features/students/data/student_repository.dart';

import 'helpers/test_setup.dart';

/// PRC-M566: `RecordingSyncDispatcher`'s default outcome is always
/// `DispatchTransient`, so every hardened journey that touches sync only
/// ever exercised the "stays queued" path. This file drives the same
/// offline-attendance journey as `journey_attendance_offline_sync_test.dart`
/// but configures the dispatcher to return a real 409 conflict / permanent
/// failure outcome instead, proving the UI (sync_conflicts row,
/// SyncStatusBanner, entityQueueStatuses) reacts correctly to both.
///
/// Marking a roster row requires a selected class *and* academic period
/// (PRC-H060's `_canMark` gate), so this harness answers the academic-period
/// fetch with one real period and selects both pickers before tapping a "P"
/// chip -- unlike `journey_attendance_offline_sync_test.dart`'s create-only
/// journey, this file also exercises the online dispatch path, which the
/// backend would reject outright without a real class/period pair.
class _AcademicPeriodOnlyAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    if (options.path.contains('/academic-periods')) {
      return ResponseBody.fromString(
        jsonEncode(<String, dynamic>{
          'data': <Map<String, dynamic>>[
            <String, dynamic>{'id': 'period-1', 'name': 'Term 1'},
          ],
        }),
        200,
        headers: <String, List<String>>{
          Headers.contentTypeHeader: <String>['application/json'],
        },
      );
    }
    throw StateError(
      'Unexpected network call during integration test: '
      '${options.method} ${options.uri}',
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  Future<void> markOneAttendancePresent(WidgetTester tester) async {
    // The academic-periods fetch runs from AttendanceScreen.initState, so
    // the stub must be installed before the screen mounts.
    getIt<Dio>().httpClientAdapter = _AcademicPeriodOnlyAdapter();

    goJourney('/attendance');
    await tester.pumpAndSettle();

    final Finder institutionField = find.byType(TextField).first;
    await tester.enterText(institutionField, 'inst-1');
    await tester.pumpAndSettle();
    final Finder loadRoster = find.text('Load roster');
    await tester.ensureVisible(loadRoster);
    await tester.tap(loadRoster);
    await tester.pumpAndSettle();

    // Select the academic period (first dropdown) so the backend-required
    // field is set.
    await tester.tap(find.byType(DropdownButtonFormField<String?>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Term 1').last);
    await tester.pumpAndSettle();

    // Select the class (second dropdown), populated from the seeded
    // student's `className`.
    await tester.tap(find.byType(DropdownButtonFormField<String?>).at(1));
    await tester.pumpAndSettle();
    await tester.tap(find.text('class-1').last);
    await tester.pumpAndSettle();

    final Finder presentChip = find.text('P');
    expect(presentChip, findsWidgets);
    await tester.tap(presentChip.first);
    await tester.pumpAndSettle();
  }

  testWidgets(
    'dispatcher returns a 409 conflict -> row lands in sync_conflicts and '
    'the SyncStatusBanner shows a conflict',
    (WidgetTester tester) async {
      final JourneyHarness harness = await bootstrapTestApp(
        tenantId: 'tenant-a',
        tenantDisplayName: 'Tenant A',
        dispatcherOutcomeFactory: (PendingSyncRow row) {
          if (row.entityType != SyncEntityType.attendance) {
            return const DispatchTransient('test');
          }
          return DispatchConflict(
            serverVersion: '2026-05-12T11:00:00Z',
            serverPayload: <String, dynamic>{
              'id': row.entityId,
              'institutionId': 'inst-1',
              'classId': 'class-1',
              'subjectId': null,
              'studentId': 'stu-1',
              'date': '2026-05-12',
              'status': 'ABSENT',
              'comment': 'Reviewed by office',
            },
          );
        },
      );
      addTearDown(harness.dispose);
      await harness.markAuthenticated(userId: 'teacher-1');

      // The attendance screen's roster list needs more vertical space than
      // the 800x600 default test surface, or the Expanded ListView
      // collapses to zero height and no roster row (and no "P" chip) ever
      // gets built, even though the roster itself is non-empty (same fix
      // used by test/attendance_screen_test.dart's widget tests).
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      // Seed through the real repository so the row is encrypted at rest
      // (plaintext payloads are refused by CacheCrypto, PRC-L008).
      await tester.runAsync(
        () => getIt<StudentRepository>().cacheStudent(
          const Student(
            id: 'stu-1',
            firstName: 'Ada',
            lastName: 'Lovelace',
            nationalId: 'A1',
            institutionId: 'inst-1',
            className: 'class-1',
            dateOfBirth: '2015-01-01',
            gender: 'F',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          ),
        ),
      );

      await pumpJourneyApp(tester);
      await markOneAttendancePresent(tester);

      final SyncEngine engine = harness.syncEngine;
      expect(await engine.pendingCount(), 1);

      harness.connectivity.emit(true);
      await _pumpUntil(
        tester,
        () async => (await engine.getConflicts()).isNotEmpty,
      );

      final List<SyncConflict> conflicts = await engine.getConflicts();
      expect(conflicts, hasLength(1));
      expect(conflicts.single.entityType, SyncEntityType.attendance);
      expect(conflicts.single.serverVersion, '2026-05-12T11:00:00Z');

      // The queue summary (what SyncStatusBanner renders from) reflects the
      // conflict, and the per-row status the roster reads also does.
      final SyncQueueSummary summary = await engine.queueSummary();
      expect(summary.conflicted, 1);
      final Map<String, SyncStatus> rowStatuses = await engine
          .entityQueueStatuses(SyncEntityType.attendance);
      expect(rowStatuses[conflicts.single.entityId], SyncStatus.conflicted);

      // The banner itself, rendered on the attendance screen, surfaces the
      // conflict count copy (not colour alone).
      await tester.pumpAndSettle();
      expect(find.textContaining('conflict with the server'), findsOneWidget);
    },
  );

  testWidgets('dispatcher returns a permanent failure -> row is parked and '
      'entityQueueStatuses reflects SyncStatus.parked', (
    WidgetTester tester,
  ) async {
    final JourneyHarness harness = await bootstrapTestApp(
      tenantId: 'tenant-a',
      tenantDisplayName: 'Tenant A',
      dispatcherOutcomeFactory: (PendingSyncRow row) {
        if (row.entityType != SyncEntityType.attendance) {
          return const DispatchTransient('test');
        }
        return const DispatchPermanent('Rejected: invalid academic period');
      },
    );
    addTearDown(harness.dispose);
    await harness.markAuthenticated(userId: 'teacher-1');

    // See the matching comment in the conflict test above: the roster
    // list needs more vertical space than the 800x600 default test
    // surface, or the Expanded ListView collapses and no roster row (and
    // no "P" chip) ever gets built.
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    // Seed through the real repository so the row is encrypted at rest
    // (plaintext payloads are refused by CacheCrypto, PRC-L008).
    await tester.runAsync(
      () => getIt<StudentRepository>().cacheStudent(
        const Student(
          id: 'stu-1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          nationalId: 'A1',
          institutionId: 'inst-1',
          className: 'class-1',
          dateOfBirth: '2015-01-01',
          gender: 'F',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        ),
      ),
    );

    await pumpJourneyApp(tester);
    await markOneAttendancePresent(tester);

    final SyncEngine engine = harness.syncEngine;
    final List<PendingSyncRow> queuedBefore = await engine.getPending();
    expect(queuedBefore, hasLength(1));
    final String entityId = queuedBefore.single.entityId!;

    harness.connectivity.emit(true);
    await _pumpUntil(tester, () async {
      final Map<String, SyncStatus> statuses = await engine.entityQueueStatuses(
        SyncEntityType.attendance,
      );
      return statuses[entityId] == SyncStatus.parked;
    });

    final SyncQueueSummary summary = await engine.queueSummary();
    expect(summary.parked, 1);
    final Map<String, SyncStatus> rowStatuses = await engine
        .entityQueueStatuses(SyncEntityType.attendance);
    expect(rowStatuses[entityId], SyncStatus.parked);

    await tester.pumpAndSettle();
    expect(find.textContaining('not sent to the server'), findsOneWidget);
  });
}

/// Repeatedly pump frames until [condition] is true, or fail after
/// [timeout].
Future<void> _pumpUntil(
  WidgetTester tester,
  Future<bool> Function() condition, {
  Duration timeout = const Duration(seconds: 5),
}) async {
  final DateTime deadline = DateTime.now().add(timeout);
  while (!await condition()) {
    if (DateTime.now().isAfter(deadline)) {
      fail('Condition was not met within ${timeout.inSeconds}s');
    }
    await tester.pump(const Duration(milliseconds: 50));
  }
}
