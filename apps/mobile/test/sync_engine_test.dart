import 'dart:async';
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/sync/connectivity_monitor.dart';
import 'package:proctira_mobile/core/sync/sync_dispatcher.dart';
import 'package:proctira_mobile/core/sync/sync_engine.dart';
import 'package:proctira_mobile/core/sync/sync_models.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class _RecordingDispatcher implements SyncDispatcher {
  _RecordingDispatcher(this._outcomes);

  final List<DispatchOutcome> _outcomes;
  final List<PendingSyncRow> received = <PendingSyncRow>[];
  int _calls = 0;

  @override
  Future<DispatchOutcome> dispatch(PendingSyncRow row) async {
    received.add(row);
    final DispatchOutcome outcome = _outcomes[_calls.clamp(0, _outcomes.length - 1)];
    _calls += 1;
    return outcome;
  }
}

Future<SyncEngine> _buildEngine({
  required AppDatabase db,
  required TenantProvider tenant,
  required FakeConnectivityMonitor connectivity,
  required SyncDispatcher dispatcher,
  Duration baseBackoff = Duration.zero,
  int maxAttempts = 3,
}) async {
  return SyncEngine(
    database: db,
    tenantProvider: tenant,
    connectivity: connectivity,
    dispatchers: <SyncEntityType, SyncDispatcher>{
      SyncEntityType.attendance: dispatcher,
    },
    baseBackoff: baseBackoff,
    maxAttempts: maxAttempts,
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

  Future<({AppDatabase db, TenantProvider tenant})> bootstrap() async {
    final Directory tempDir = await Directory.systemTemp.createTemp('sync_test_');
    final AppDatabase db = AppDatabase(overridePath: '${tempDir.path}/openemis.db');
    final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
    await secure.writeTenant(tenantId: 'tenant-a', displayName: 'Tenant A');
    final TenantProvider tenant = TenantProvider(secure);
    await tenant.bootstrap();
    return (db: db, tenant: tenant);
  }

  test('saveLocallyAndQueue persists cache row + pending op atomically', () async {
    final ({AppDatabase db, TenantProvider tenant}) ctx = await bootstrap();
    final FakeConnectivityMonitor connectivity = FakeConnectivityMonitor();
    final _RecordingDispatcher dispatcher = _RecordingDispatcher(
      <DispatchOutcome>[const DispatchTransient('offline')],
    );
    final SyncEngine engine = await _buildEngine(
      db: ctx.db,
      tenant: ctx.tenant,
      connectivity: connectivity,
      dispatcher: dispatcher,
    );

    final int rowId = await engine.saveLocallyAndQueue(
      entityType: SyncEntityType.attendance,
      operation: SyncOperation.create,
      cacheTable: 'attendance_offline',
      cachePayload: <String, Object?>{
        'id': 'att-1',
        'tenant_id': 'tenant-a',
        'institution_id': 'inst-1',
        'student_id': 'stu-1',
        'attendance_date': '2026-05-12',
        'status': 'PRESENT',
        'recorded_at': DateTime.now().millisecondsSinceEpoch,
        'synced': 0,
      },
      syncPayload: <String, dynamic>{
        'studentId': 'stu-1',
        'institutionId': 'inst-1',
        'attendanceDate': '2026-05-12',
        'status': 'PRESENT',
      },
      entityId: 'att-1',
    );

    expect(rowId, greaterThan(0));
    final List<PendingSyncRow> queue = await engine.getPending();
    expect(queue, hasLength(1));
    expect(queue.first.entityId, 'att-1');
    expect(queue.first.entityType, SyncEntityType.attendance);
    expect(queue.first.operation, SyncOperation.create);
    expect(queue.first.payload['status'], 'PRESENT');

    // Cache row should also exist.
    final List<Map<String, Object?>> cache =
        await (await ctx.db.database).query('attendance_offline');
    expect(cache, hasLength(1));
    expect(cache.first['id'], 'att-1');

    await ctx.db.close();
  });

  test('flushPending no-ops when offline', () async {
    final ({AppDatabase db, TenantProvider tenant}) ctx = await bootstrap();
    final FakeConnectivityMonitor connectivity = FakeConnectivityMonitor();
    final _RecordingDispatcher dispatcher = _RecordingDispatcher(
      <DispatchOutcome>[
        DispatchSuccess(
          serverEntity: const <String, dynamic>{},
          serverVersion: 'v1',
          serverEntityId: 'att-1',
        ),
      ],
    );
    final SyncEngine engine = await _buildEngine(
      db: ctx.db,
      tenant: ctx.tenant,
      connectivity: connectivity,
      dispatcher: dispatcher,
    );

    await engine.enqueue(
      entityType: SyncEntityType.attendance,
      operation: SyncOperation.create,
      syncPayload: const <String, dynamic>{'foo': 'bar'},
      entityId: 'att-1',
    );

    final SyncFlushResult result = await engine.flushPending();
    expect(result.processed, 0);
    expect(dispatcher.received, isEmpty);

    await ctx.db.close();
  });

  test('connectivity restore drains the queue and dequeues on success', () async {
    final ({AppDatabase db, TenantProvider tenant}) ctx = await bootstrap();
    final FakeConnectivityMonitor connectivity = FakeConnectivityMonitor();
    final _RecordingDispatcher dispatcher = _RecordingDispatcher(
      <DispatchOutcome>[
        DispatchSuccess(
          serverEntity: const <String, dynamic>{
            'id': 'att-1',
            'updatedAt': '2026-05-12T10:00:00Z',
          },
          serverVersion: '2026-05-12T10:00:00Z',
          serverEntityId: 'att-1',
        ),
      ],
    );
    final SyncEngine engine = await _buildEngine(
      db: ctx.db,
      tenant: ctx.tenant,
      connectivity: connectivity,
      dispatcher: dispatcher,
    );

    // Save while offline.
    await engine.saveLocallyAndQueue(
      entityType: SyncEntityType.attendance,
      operation: SyncOperation.create,
      cacheTable: 'attendance_offline',
      cachePayload: <String, Object?>{
        'id': 'att-1',
        'tenant_id': 'tenant-a',
        'institution_id': 'inst-1',
        'student_id': 'stu-1',
        'attendance_date': '2026-05-12',
        'status': 'PRESENT',
        'recorded_at': DateTime.now().millisecondsSinceEpoch,
        'synced': 0,
      },
      syncPayload: const <String, dynamic>{
        'studentId': 'stu-1',
        'institutionId': 'inst-1',
        'attendanceDate': '2026-05-12',
        'status': 'PRESENT',
      },
      entityId: 'att-1',
    );

    expect(await engine.pendingCount(), 1);

    // Start the engine and flip to online; the engine should drain the queue.
    final Completer<void> drained = Completer<void>();
    engine.start();
    Timer.periodic(const Duration(milliseconds: 25), (Timer t) async {
      if (await engine.pendingCount() == 0) {
        t.cancel();
        if (!drained.isCompleted) drained.complete();
      }
    });
    connectivity.emit(true);

    await drained.future.timeout(const Duration(seconds: 5));
    expect(dispatcher.received, hasLength(1));
    expect(await engine.pendingCount(), 0);

    await engine.stop();
    await ctx.db.close();
  });

  test('transient failures increment attempts and park after maxAttempts', () async {
    final ({AppDatabase db, TenantProvider tenant}) ctx = await bootstrap();
    final FakeConnectivityMonitor connectivity = FakeConnectivityMonitor(startsOnline: true);
    final _RecordingDispatcher dispatcher = _RecordingDispatcher(
      <DispatchOutcome>[
        const DispatchTransient('boom'),
        const DispatchTransient('boom'),
        const DispatchTransient('boom'),
      ],
    );
    final SyncEngine engine = await _buildEngine(
      db: ctx.db,
      tenant: ctx.tenant,
      connectivity: connectivity,
      dispatcher: dispatcher,
      maxAttempts: 3,
    );

    await engine.enqueue(
      entityType: SyncEntityType.attendance,
      operation: SyncOperation.create,
      syncPayload: const <String, dynamic>{'foo': 'bar'},
      entityId: 'att-1',
    );

    final SyncFlushResult r1 = await engine.flushPending();
    expect(r1.failed, 1);
    final List<PendingSyncRow> afterFirst = await engine.getPending();
    expect(afterFirst.first.attempts, 1);
    expect(afterFirst.first.status, SyncStatus.pending);

    final SyncFlushResult r2 = await engine.flushPending();
    expect(r2.failed, 1);
    final List<PendingSyncRow> afterSecond = await engine.getPending();
    expect(afterSecond.first.attempts, 2);
    expect(afterSecond.first.status, SyncStatus.pending);

    final SyncFlushResult r3 = await engine.flushPending();
    expect(r3.parked, 1);
    final List<PendingSyncRow> afterThird = await engine.getPending();
    expect(afterThird.first.attempts, 3);
    expect(afterThird.first.status, SyncStatus.parked);

    // Parked rows should not be picked up again.
    final SyncFlushResult r4 = await engine.flushPending();
    expect(r4.processed, 0);
    expect(dispatcher.received, hasLength(3));

    await ctx.db.close();
  });

  test('409 conflict moves the row into sync_conflicts (server wins)', () async {
    final ({AppDatabase db, TenantProvider tenant}) ctx = await bootstrap();
    final FakeConnectivityMonitor connectivity = FakeConnectivityMonitor(startsOnline: true);
    final _RecordingDispatcher dispatcher = _RecordingDispatcher(
      <DispatchOutcome>[
        const DispatchConflict(
          serverVersion: '2026-05-12T11:00:00Z',
          serverPayload: <String, dynamic>{
            'id': 'att-1',
            'tenantId': 'tenant-a',
            'institutionId': 'inst-1',
            'classId': null,
            'subjectId': null,
            'periodId': null,
            'studentId': 'stu-1',
            'attendanceDate': '2026-05-12',
            'status': 'EXCUSED',
            'comment': 'Already updated',
            'recordedBy': 'admin',
            'createdAt': '2026-05-12T10:00:00Z',
            'updatedAt': '2026-05-12T11:00:00Z',
          },
        ),
      ],
    );
    final SyncEngine engine = await _buildEngine(
      db: ctx.db,
      tenant: ctx.tenant,
      connectivity: connectivity,
      dispatcher: dispatcher,
    );

    await engine.saveLocallyAndQueue(
      entityType: SyncEntityType.attendance,
      operation: SyncOperation.update,
      cacheTable: 'attendance_offline',
      cachePayload: <String, Object?>{
        'id': 'att-1',
        'tenant_id': 'tenant-a',
        'institution_id': 'inst-1',
        'student_id': 'stu-1',
        'attendance_date': '2026-05-12',
        'status': 'ABSENT',
        'recorded_at': DateTime.now().millisecondsSinceEpoch,
        'synced': 0,
        'version': '2026-05-12T10:00:00Z',
      },
      syncPayload: const <String, dynamic>{
        'id': 'att-1',
        'studentId': 'stu-1',
        'institutionId': 'inst-1',
        'attendanceDate': '2026-05-12',
        'status': 'ABSENT',
        'recordedBy': 'admin',
        'createdAt': '2026-05-12T10:00:00Z',
        'updatedAt': '2026-05-12T10:00:00Z',
      },
      entityId: 'att-1',
      baseVersion: '2026-05-12T10:00:00Z',
    );

    final SyncFlushResult result = await engine.flushPending();
    expect(result.conflicted, 1);

    final List<SyncConflict> conflicts = await engine.getConflicts();
    expect(conflicts, hasLength(1));
    expect(conflicts.first.entityId, 'att-1');
    expect(conflicts.first.serverVersion, '2026-05-12T11:00:00Z');
    expect(conflicts.first.localPayload['status'], 'ABSENT');

    // Server-wins: cache should reflect the server payload now.
    final List<Map<String, Object?>> cache =
        await (await ctx.db.database).query('attendance_offline');
    expect(cache.first['status'], 'EXCUSED');
    expect(cache.first['version'], '2026-05-12T11:00:00Z');

    await ctx.db.close();
  });

  test('saveLocallyAndQueue without an active tenant throws', () async {
    final Directory tempDir =
        await Directory.systemTemp.createTemp('sync_test_no_tenant_');
    final AppDatabase db = AppDatabase(overridePath: '${tempDir.path}/openemis.db');
    final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
    final TenantProvider tenant = TenantProvider(secure);
    await tenant.bootstrap();

    final FakeConnectivityMonitor connectivity = FakeConnectivityMonitor();
    final _RecordingDispatcher dispatcher = _RecordingDispatcher(
      <DispatchOutcome>[const DispatchTransient('n/a')],
    );
    final SyncEngine engine = await _buildEngine(
      db: db,
      tenant: tenant,
      connectivity: connectivity,
      dispatcher: dispatcher,
    );

    await expectLater(
      engine.enqueue(
        entityType: SyncEntityType.attendance,
        operation: SyncOperation.create,
        syncPayload: const <String, dynamic>{},
      ),
      throwsA(isA<StateError>()),
    );

    await db.close();
  });
}
