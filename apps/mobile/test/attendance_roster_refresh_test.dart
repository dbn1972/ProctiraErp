import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:proctira_mobile/core/storage/cache_crypto.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/sync/connectivity_monitor.dart';
import 'package:proctira_mobile/core/sync/sync_dispatcher.dart';
import 'package:proctira_mobile/core/sync/sync_engine.dart';
import 'package:proctira_mobile/core/sync/sync_models.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/attendance/data/attendance_repository.dart';
import 'package:proctira_mobile/features/attendance/presentation/attendance_class_picker.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/fake_student_api.dart';

class _OkDispatcher implements SyncDispatcher {
  const _OkDispatcher();

  @override
  Future<DispatchOutcome> dispatch(PendingSyncRow row) async => DispatchSuccess(
    serverEntity: Map<String, dynamic>.from(row.payload),
    serverVersion: '2026-01-05T00:00:00Z',
  );
}

Future<
  ({AttendanceRepository repo, AppDatabase db, FakeConnectivityMonitor net})
>
_bootstrap(FakeStudentApi api) async {
  final Directory tempDir = await Directory.systemTemp.createTemp('roster_');
  final AppDatabase db = AppDatabase(overridePath: '${tempDir.path}/r.db');
  final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
  await secure.writeTenant(tenantId: 'tenant-a', displayName: 'Tenant A');
  final CacheCrypto crypto = await CacheCrypto.fromSecureStorage(secure);
  final TenantProvider tenant = TenantProvider(secure);
  await tenant.bootstrap();
  final FakeConnectivityMonitor net = FakeConnectivityMonitor();
  final SyncEngine engine = SyncEngine(
    database: db,
    tenantProvider: tenant,
    connectivity: net,
    dispatchers: const <SyncEntityType, SyncDispatcher>{
      SyncEntityType.attendance: _OkDispatcher(),
    },
    baseBackoff: Duration.zero,
  );
  return (
    repo: AttendanceRepository(
      database: db,
      tenantProvider: tenant,
      syncEngine: engine,
      cacheCrypto: crypto,
      studentApi: api,
    ),
    db: db,
    net: net,
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  test('PRC-M032: 250 students across 3 pages are all loaded', () async {
    final FakeStudentApi api = FakeStudentApi(<Student>[
      for (int i = 0; i < 250; i++) fakeStudent(i),
    ]);
    final ctx = await _bootstrap(api);
    final RosterLoadResult result = await ctx.repo.loadRosterWithStatus(
      institutionId: 'inst-1',
      date: '2026-01-05',
    );
    expect(result.entries, hasLength(250));
    expect(api.requestedPages, <int>[1, 2, 3]);
    expect(result.refreshed, isTrue);
    expect(result.isStale, isFalse);
  });

  test(
    'PRC-M032: non-empty cache is refreshed; removed students drop out',
    () async {
      final FakeStudentApi api = FakeStudentApi(<Student>[
        fakeStudent(1),
        fakeStudent(2),
      ]);
      final ctx = await _bootstrap(api);
      await ctx.repo.loadRoster(institutionId: 'inst-1', date: '2026-01-05');
      api.students = <Student>[fakeStudent(2), fakeStudent(3)];
      final List<AttendanceRosterEntry> after = await ctx.repo.loadRoster(
        institutionId: 'inst-1',
        date: '2026-01-05',
      );
      expect(
        after.map((AttendanceRosterEntry e) => e.studentId),
        unorderedEquals(<String>['stu-2', 'stu-3']),
      );
    },
  );

  test('PRC-M032: API 500 is reported, cached rows are kept', () async {
    final FakeStudentApi api = FakeStudentApi(<Student>[fakeStudent(1)]);
    final ctx = await _bootstrap(api);
    await ctx.repo.loadRoster(institutionId: 'inst-1', date: '2026-01-05');
    api.failWith = const TransientApiException('boom', statusCode: 500);
    final RosterLoadResult result = await ctx.repo.loadRosterWithStatus(
      institutionId: 'inst-1',
      date: '2026-01-05',
    );
    expect(result.isStale, isTrue);
    expect(result.refreshError, isA<TransientApiException>());
    expect(result.entries, hasLength(1));
  });

  test('PRC-M032: API 500 with empty cache surfaces the error', () async {
    final FakeStudentApi api = FakeStudentApi(<Student>[])
      ..failWith = const TransientApiException('boom', statusCode: 500);
    final ctx = await _bootstrap(api);
    final RosterLoadResult result = await ctx.repo.loadRosterWithStatus(
      institutionId: 'inst-1',
      date: '2026-01-05',
    );
    expect(result.entries, isEmpty);
    expect(result.refreshError, isNotNull);
  });

  test(
    'PRC-M031: class filter returns matching students from API data',
    () async {
      final FakeStudentApi api = FakeStudentApi(<Student>[
        fakeStudent(1, className: 'Grade 5 A'),
        fakeStudent(2, className: 'Grade 5 B'),
        fakeStudent(3, className: 'Grade 5 A'),
      ]);
      final ctx = await _bootstrap(api);
      final RosterLoadResult all = await ctx.repo.loadRosterWithStatus(
        institutionId: 'inst-1',
        date: '2026-01-05',
      );
      expect(all.knownClasses, <String>['Grade 5 A', 'Grade 5 B']);
      final List<AttendanceRosterEntry> filtered = await ctx.repo.loadRoster(
        institutionId: 'inst-1',
        classId: 'grade 5 a',
        date: '2026-01-05',
        refresh: false,
      );
      expect(
        filtered.map((AttendanceRosterEntry e) => e.studentId),
        unorderedEquals(<String>['stu-1', 'stu-3']),
      );
    },
  );

  testWidgets('PRC-M031: class picker offers only known classes', (
    WidgetTester tester,
  ) async {
    String? picked = 'unset';
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AttendanceClassPicker(
            classes: const <String>['Grade 5 A', 'Grade 5 B'],
            value: null,
            onChanged: (String? v) => picked = v,
          ),
        ),
      ),
    );
    await tester.tap(find.text(AttendanceClassPicker.allClassesLabel));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Grade 5 B').last);
    await tester.pumpAndSettle();
    expect(picked, 'Grade 5 B');
  });

  test('PRC-M038: submit flushes the queue and reports the result', () async {
    final FakeStudentApi api = FakeStudentApi(<Student>[fakeStudent(1)]);
    final ctx = await _bootstrap(api);
    final List<AttendanceRosterEntry> roster = await ctx.repo.loadRoster(
      institutionId: 'inst-1',
      date: '2026-01-05',
    );
    await ctx.repo.markAttendance(
      entry: roster.single,
      institutionId: 'inst-1',
      classId: 'class-1',
      academicPeriodId: 'period-1',
      date: '2026-01-05',
      status: AttendanceStatus.present,
      recordedBy: 'teacher-1',
    );
    final AttendanceSubmitSummary offline = await ctx.repo.submitPending();
    expect(offline.stillQueued, 1);
    expect(offline.describe(), contains('1 waiting to sync'));

    ctx.net.emit(true);
    final AttendanceSubmitSummary online = await ctx.repo.submitPending();
    expect(online.synced, 1);
    expect(online.allSent, isTrue);
    expect(online.describe(), 'Submitted 1 attendance mark.');
  });
}
