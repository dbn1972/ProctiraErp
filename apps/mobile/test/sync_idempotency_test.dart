import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/sync/connectivity_monitor.dart';
import 'package:proctira_mobile/core/sync/sync_engine.dart';
import 'package:proctira_mobile/core/sync/sync_models.dart';
import 'package:proctira_mobile/core/sync/sync_queue.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// W2-MOB-03: pending_sync rows must carry a unique idempotency key.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  Future<({AppDatabase db, TenantProvider tenant, SyncQueue queue})> bootstrap() async {
    final Directory tempDir = await Directory.systemTemp.createTemp('sync_idem_');
    final AppDatabase db = AppDatabase(overridePath: '${tempDir.path}/openemis.db');
    final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
    await secure.writeTenant(tenantId: 'tenant-a', displayName: 'Tenant A');
    final TenantProvider tenant = TenantProvider(secure);
    await tenant.bootstrap();
    final SyncQueue queue = SyncQueue(
      database: db,
      tenantProvider: tenant,
      connectivity: FakeConnectivityMonitor(),
    );
    return (db: db, tenant: tenant, queue: queue);
  }

  test('enqueue persists a non-empty idempotency_key', () async {
    final ctx = await bootstrap();
    final SyncEngine engine = SyncEngine(
      database: ctx.db,
      tenantProvider: ctx.tenant,
      connectivity: FakeConnectivityMonitor(),
      dispatchers: const {},
    );
    final int id = await engine.enqueue(
      entityType: SyncEntityType.attendance,
      operation: SyncOperation.create,
      syncPayload: <String, dynamic>{'studentId': 's1'},
    );
    expect(id, greaterThan(0));
    final pending = await engine.getPending();
    expect(pending, hasLength(1));
    expect(pending.first.idempotencyKey.length, greaterThanOrEqualTo(8));
  });

  test('duplicate idempotency keys are rejected by unique index', () async {
    final ctx = await bootstrap();
    final SyncEngine engine = SyncEngine(
      database: ctx.db,
      tenantProvider: ctx.tenant,
      connectivity: FakeConnectivityMonitor(),
      dispatchers: const {},
    );
    await engine.enqueue(
      entityType: SyncEntityType.attendance,
      operation: SyncOperation.create,
      syncPayload: <String, dynamic>{'studentId': 's1'},
      idempotencyKey: 'fixed-key-0001',
    );
    await expectLater(
      () => engine.enqueue(
        entityType: SyncEntityType.attendance,
        operation: SyncOperation.create,
        syncPayload: <String, dynamic>{'studentId': 's1'},
        idempotencyKey: 'fixed-key-0001',
      ),
      throwsA(isA<DatabaseException>()),
    );
  });

  test('engine enqueue auto-generates distinct keys', () async {
    final ctx = await bootstrap();
    final SyncEngine engine = SyncEngine(
      database: ctx.db,
      tenantProvider: ctx.tenant,
      connectivity: FakeConnectivityMonitor(),
      dispatchers: const {},
    );
    await engine.enqueue(
      entityType: SyncEntityType.attendance,
      operation: SyncOperation.create,
      syncPayload: <String, dynamic>{'studentId': 's1'},
    );
    await engine.enqueue(
      entityType: SyncEntityType.attendance,
      operation: SyncOperation.create,
      syncPayload: <String, dynamic>{'studentId': 's2'},
    );
    final pending = await engine.getPending();
    expect(pending, hasLength(2));
    expect(pending[0].idempotencyKey, isNot(equals(pending[1].idempotencyKey)));
  });
}
