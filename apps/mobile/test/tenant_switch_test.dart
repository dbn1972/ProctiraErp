import 'dart:io';
import 'dart:typed_data';

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
import 'package:proctira_mobile/core/sync/unsynced_work.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/core/tenant/tenant_switch.dart';
import 'package:proctira_mobile/features/students/data/student_repository.dart';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class _NoopDispatcher implements SyncDispatcher {
  const _NoopDispatcher();

  @override
  Future<DispatchOutcome> dispatch(PendingSyncRow row) async =>
      const DispatchTransient('offline');
}

/// PRC-M565: a tenant switch on a shared device wipes the previous tenant's
/// session and cached child data; ciphertext is unreadable under another key.
/// Unsynced offline work is never purged without explicit confirmation (the
/// same rule as the signed-in switch, PR #542).
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });
  setUp(() => FlutterSecureStorage.setMockInitialValues(<String, String>{}));

  Future<
    ({
      AppDatabase db,
      SecureStorage secure,
      TenantProvider tenant,
      StudentRepository students,
      Directory dir,
    })
  >
  build() async {
    final Directory dir = await Directory.systemTemp.createTemp('m565_');
    final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
    await secure.writeTokens(
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
    );
    await secure.writeTenant(tenantId: 'tenant-a', displayName: 'A');
    final AppDatabase db = AppDatabase(overridePath: '${dir.path}/m565.db');
    final TenantProvider tenant = TenantProvider(secure);
    await tenant.bootstrap();
    final StudentRepository students = StudentRepository(
      database: db,
      tenantProvider: tenant,
      syncEngine: SyncEngine(
        database: db,
        tenantProvider: tenant,
        connectivity: FakeConnectivityMonitor(),
        dispatchers: const <SyncEntityType, SyncDispatcher>{
          SyncEntityType.student: _NoopDispatcher(),
        },
        baseBackoff: Duration.zero,
      ),
      cacheCrypto: await CacheCrypto.fromSecureStorage(secure),
    );
    await students.cacheStudent(
      const Student(
        id: 'stu-a-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        nationalId: 'A1',
        institutionId: 'inst-a',
        dateOfBirth: '2015-01-01',
        gender: 'F',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      ),
    );
    return (
      db: db,
      secure: secure,
      tenant: tenant,
      students: students,
      dir: dir,
    );
  }

  Future<int> count(AppDatabase db, String table) async {
    final Database raw = await db.database;
    return Sqflite.firstIntValue(
          await raw.rawQuery('SELECT COUNT(*) AS c FROM $table'),
        ) ??
        -1;
  }

  test('switching to a different tenant purges caches and session', () async {
    final ctx = await build();
    expect(await count(ctx.db, 'students_cache'), 1);

    final TenantSwitchResult result = await TenantSwitcher(
      tenantProvider: ctx.tenant,
      storage: ctx.secure,
      database: ctx.db,
    ).switchTo(tenantId: 'tenant-b', displayName: 'B');

    expect(result.isBlocked, isFalse);
    expect(result.purged, isTrue);
    expect(ctx.tenant.tenantId, 'tenant-b');
    expect(await count(ctx.db, 'students_cache'), 0);
    expect(await ctx.secure.readAccessToken(), isNull);
    expect(await ctx.secure.readRefreshToken(), isNull);
    await ctx.db.close();
    await ctx.dir.delete(recursive: true);
  });

  test('re-selecting the same tenant keeps local data', () async {
    final ctx = await build();
    final TenantSwitchResult result = await TenantSwitcher(
      tenantProvider: ctx.tenant,
      storage: ctx.secure,
      database: ctx.db,
    ).switchTo(tenantId: 'tenant-a');

    expect(result.isBlocked, isFalse);
    expect(result.purged, isFalse);
    expect(await count(ctx.db, 'students_cache'), 1);
    expect(await ctx.secure.readAccessToken(), 'access-a');
    await ctx.db.close();
    await ctx.dir.delete(recursive: true);
  });

  /// Queue an attendance mark the way the attendance screen does while
  /// offline: cache row + `pending_sync` row in one transaction.
  Future<void> queueOfflineMark(AppDatabase db, TenantProvider tenant) async {
    final SyncEngine engine = SyncEngine(
      database: db,
      tenantProvider: tenant,
      connectivity: FakeConnectivityMonitor(),
      dispatchers: const <SyncEntityType, SyncDispatcher>{},
    );
    await engine.saveLocallyAndQueue(
      entityType: SyncEntityType.attendance,
      operation: SyncOperation.create,
      cacheTable: 'attendance_offline',
      cachePayload: <String, Object?>{
        'id': 'att-a-1',
        'tenant_id': 'tenant-a',
        'institution_id': 'inst-a',
        'student_id': 'stu-a-1',
        'attendance_date': '2026-05-12',
        'status': 'PRESENT',
        'recorded_at': DateTime.now().millisecondsSinceEpoch,
        'synced': 0,
      },
      syncPayload: <String, dynamic>{
        'studentId': 'stu-a-1',
        'institutionId': 'inst-a',
        'attendanceDate': '2026-05-12',
        'status': 'PRESENT',
      },
      entityId: 'att-a-1',
    );
  }

  test('unsynced offline work blocks the switch; nothing is purged', () async {
    final ctx = await build();
    await queueOfflineMark(ctx.db, ctx.tenant);

    final TenantSwitchResult result = await TenantSwitcher(
      tenantProvider: ctx.tenant,
      storage: ctx.secure,
      database: ctx.db,
    ).switchTo(tenantId: 'tenant-b', displayName: 'B');

    expect(result.isBlocked, isTrue);
    expect(result.purged, isFalse);
    expect(result.blockedBy!.queuedChanges, 1);
    expect(ctx.tenant.tenantId, 'tenant-a');
    expect(await count(ctx.db, 'pending_sync'), 1);
    expect(await count(ctx.db, 'attendance_offline'), 1);
    expect(await count(ctx.db, 'students_cache'), 1);
    expect(await ctx.secure.readAccessToken(), 'access-a');
    await ctx.db.close();
    await ctx.dir.delete(recursive: true);
  });

  test('explicit discard purges unsynced work and switches', () async {
    final ctx = await build();
    await queueOfflineMark(ctx.db, ctx.tenant);

    final TenantSwitchResult result = await TenantSwitcher(
      tenantProvider: ctx.tenant,
      storage: ctx.secure,
      database: ctx.db,
    ).switchTo(tenantId: 'tenant-b', discardUnsyncedWork: true);

    expect(result.isBlocked, isFalse);
    expect(result.purged, isTrue);
    expect(ctx.tenant.tenantId, 'tenant-b');
    expect(await count(ctx.db, 'pending_sync'), 0);
    expect(await count(ctx.db, 'attendance_offline'), 0);
    expect(await ctx.secure.readAccessToken(), isNull);
    await ctx.db.close();
    await ctx.dir.delete(recursive: true);
  });

  test('an unreadable queue fails closed', () async {
    final ctx = await build();

    final TenantSwitchResult result = await TenantSwitcher(
      tenantProvider: ctx.tenant,
      storage: ctx.secure,
      database: ctx.db,
      inspectUnsyncedWork: () async => throw StateError('db closed'),
    ).switchTo(tenantId: 'tenant-b');

    expect(result.blockedBy, const UnsyncedWork.unknown());
    expect(ctx.tenant.tenantId, 'tenant-a');
    expect(await count(ctx.db, 'students_cache'), 1);
    expect(await ctx.secure.readAccessToken(), 'access-a');
    await ctx.db.close();
    await ctx.dir.delete(recursive: true);
  });

  test('cached ciphertext is unreadable after a key change', () async {
    final CacheCrypto keyA = CacheCrypto(
      Uint8List.fromList(List<int>.generate(32, (int i) => i)),
    );
    final CacheCrypto keyB = CacheCrypto(
      Uint8List.fromList(List<int>.generate(32, (int i) => 255 - i)),
    );
    final String context = CacheCrypto.rowContext(
      tenantId: 'tenant-a',
      table: 'students_cache',
      id: 'stu-a-1',
    );
    final String cipher = await keyA.encrypt(
      '{"firstName":"Ada"}',
      context: context,
    );
    expect(await keyA.decrypt(cipher, context: context), '{"firstName":"Ada"}');
    await expectLater(
      keyB.decrypt(cipher, context: context),
      throwsA(anything),
    );
  });
}
