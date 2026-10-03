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

    final bool purged = await TenantSwitcher(
      tenantProvider: ctx.tenant,
      storage: ctx.secure,
      database: ctx.db,
    ).switchTo(tenantId: 'tenant-b', displayName: 'B');

    expect(purged, isTrue);
    expect(ctx.tenant.tenantId, 'tenant-b');
    expect(await count(ctx.db, 'students_cache'), 0);
    expect(await ctx.secure.readAccessToken(), isNull);
    expect(await ctx.secure.readRefreshToken(), isNull);
    await ctx.db.close();
    await ctx.dir.delete(recursive: true);
  });

  test('re-selecting the same tenant keeps local data', () async {
    final ctx = await build();
    final bool purged = await TenantSwitcher(
      tenantProvider: ctx.tenant,
      storage: ctx.secure,
      database: ctx.db,
    ).switchTo(tenantId: 'tenant-a');

    expect(purged, isFalse);
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
