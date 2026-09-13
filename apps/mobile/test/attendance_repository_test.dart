import 'dart:io';

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
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class _NoopDispatcher implements SyncDispatcher {
  const _NoopDispatcher();

  @override
  Future<DispatchOutcome> dispatch(PendingSyncRow row) async {
    return const DispatchTransient('test offline');
  }
}

Future<({AppDatabase db, TenantProvider tenant, SyncEngine engine, CacheCrypto crypto})> _bootstrap() async {
  final Directory tempDir = await Directory.systemTemp.createTemp('att_repo_');
  final AppDatabase db = AppDatabase(overridePath: '${tempDir.path}/openemis.db');
  final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
  await secure.writeTenant(tenantId: 'tenant-a', displayName: 'Tenant A');
  final CacheCrypto crypto = await CacheCrypto.fromSecureStorage(secure);
  final TenantProvider tenant = TenantProvider(secure);
  await tenant.bootstrap();
  final FakeConnectivityMonitor connectivity = FakeConnectivityMonitor();
  final SyncEngine engine = SyncEngine(
    database: db,
    tenantProvider: tenant,
    connectivity: connectivity,
    dispatchers: const <SyncEntityType, SyncDispatcher>{
      SyncEntityType.attendance: _NoopDispatcher(),
    },
    baseBackoff: Duration.zero,
  );
  return (db: db, tenant: tenant, engine: engine, crypto: crypto);
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

  test('loadRoster returns rows from students_cache filtered by institution',
      () async {
    final ({AppDatabase db, TenantProvider tenant, SyncEngine engine, CacheCrypto crypto}) ctx =
        await _bootstrap();
    final Database raw = await ctx.db.database;
    await raw.insert('students_cache', <String, Object?>{
      'id': 'stu-1',
      'tenant_id': 'tenant-a',
      'institution_id': 'inst-1',
      'full_name': 'Ada Lovelace',
      'national_id': 'A1',
      'grade': null,
      'class_name': null,
      'payload': '{}',
      'updated_at': 1,
    });
    await raw.insert('students_cache', <String, Object?>{
      'id': 'stu-2',
      'tenant_id': 'tenant-a',
      'institution_id': 'inst-2',
      'full_name': 'Grace Hopper',
      'national_id': 'A2',
      'grade': null,
      'class_name': null,
      'payload': '{}',
      'updated_at': 1,
    });

    final AttendanceRepository repo = AttendanceRepository(
      database: ctx.db,
      tenantProvider: ctx.tenant,
      syncEngine: ctx.engine,
      cacheCrypto: ctx.crypto,
    );

    final List<AttendanceRosterEntry> roster = await repo.loadRoster(
      institutionId: 'inst-1',
      date: '2026-05-12',
    );
    expect(roster, hasLength(1));
    expect(roster.first.studentId, 'stu-1');
    expect(roster.first.studentName, 'Ada Lovelace');
    expect(roster.first.status, isNull);

    await ctx.db.close();
  });

  test('markAttendance saves to attendance_offline and queues a sync op',
      () async {
    final ({AppDatabase db, TenantProvider tenant, SyncEngine engine, CacheCrypto crypto}) ctx =
        await _bootstrap();
    final Database raw = await ctx.db.database;
    await raw.insert('students_cache', <String, Object?>{
      'id': 'stu-1',
      'tenant_id': 'tenant-a',
      'institution_id': 'inst-1',
      'full_name': 'Ada Lovelace',
      'national_id': 'A1',
      'grade': null,
      'class_name': null,
      'payload': '{}',
      'updated_at': 1,
    });

    final AttendanceRepository repo = AttendanceRepository(
      database: ctx.db,
      tenantProvider: ctx.tenant,
      syncEngine: ctx.engine,
      cacheCrypto: ctx.crypto,
    );

    final List<AttendanceRosterEntry> roster = await repo.loadRoster(
      institutionId: 'inst-1',
      date: '2026-05-12',
    );

    await repo.markAttendance(
      entry: roster.first,
      institutionId: 'inst-1',
      date: '2026-05-12',
      status: AttendanceStatus.present,
      recordedBy: 'admin',
    );

    // The offline cache row exists.
    final List<Map<String, Object?>> attendance = await raw.query(
      'attendance_offline',
      where: 'student_id = ?',
      whereArgs: <Object>['stu-1'],
    );
    expect(attendance, hasLength(1));
    expect(attendance.first['status'], 'PRESENT');

    // A sync op was queued.
    final List<PendingSyncRow> queue = await ctx.engine.getPending();
    expect(queue, hasLength(1));
    expect(queue.first.entityType, SyncEntityType.attendance);
    expect(queue.first.operation, SyncOperation.create);
    expect(queue.first.payload['status'], 'PRESENT');
    expect(queue.first.payload['studentId'], 'stu-1');

    // Reloading the roster reflects the new status.
    final List<AttendanceRosterEntry> after = await repo.loadRoster(
      institutionId: 'inst-1',
      date: '2026-05-12',
    );
    expect(after.first.status, AttendanceStatus.present);
    expect(after.first.recordId, isNotNull);

    await ctx.db.close();
  });

  test('markAttendance update path queues an update op with base version',
      () async {
    final ({AppDatabase db, TenantProvider tenant, SyncEngine engine, CacheCrypto crypto}) ctx =
        await _bootstrap();
    final Database raw = await ctx.db.database;
    await raw.insert('students_cache', <String, Object?>{
      'id': 'stu-1',
      'tenant_id': 'tenant-a',
      'institution_id': 'inst-1',
      'full_name': 'Ada Lovelace',
      'national_id': 'A1',
      'grade': null,
      'class_name': null,
      'payload': '{}',
      'updated_at': 1,
    });

    final AttendanceRepository repo = AttendanceRepository(
      database: ctx.db,
      tenantProvider: ctx.tenant,
      syncEngine: ctx.engine,
      cacheCrypto: ctx.crypto,
    );

    AttendanceRosterEntry entry = (await repo.loadRoster(
      institutionId: 'inst-1',
      date: '2026-05-12',
    ))
        .first;

    final AttendanceRosterEntry afterCreate = await repo.markAttendance(
      entry: entry,
      institutionId: 'inst-1',
      date: '2026-05-12',
      status: AttendanceStatus.present,
      recordedBy: 'admin',
    );

    // Simulate a server confirmation (sets version + clears synced=0).
    await raw.update(
      'attendance_offline',
      <String, Object?>{'version': 'v-1', 'synced': 1},
      where: 'id = ?',
      whereArgs: <Object?>[afterCreate.recordId],
    );

    entry = (await repo.loadRoster(
      institutionId: 'inst-1',
      date: '2026-05-12',
    ))
        .first;
    expect(entry.version, 'v-1');

    await repo.markAttendance(
      entry: entry,
      institutionId: 'inst-1',
      date: '2026-05-12',
      status: AttendanceStatus.late,
      recordedBy: 'admin',
    );

    final List<PendingSyncRow> queue = await ctx.engine.getPending();
    expect(queue, hasLength(2));
    final PendingSyncRow updateRow =
        queue.firstWhere((PendingSyncRow r) => r.operation == SyncOperation.update);
    expect(updateRow.baseVersion, 'v-1');
    expect(updateRow.payload['status'], 'LATE');

    await ctx.db.close();
  });
}
