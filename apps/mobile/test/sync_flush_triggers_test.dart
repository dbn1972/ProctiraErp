// PRC-H010: the offline queue must drain without a connectivity-change event
// when the device is already online (enqueue while online, rows left over
// from a previous launch).
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

class _SuccessDispatcher implements SyncDispatcher {
  final List<PendingSyncRow> received = <PendingSyncRow>[];

  @override
  Future<DispatchOutcome> dispatch(PendingSyncRow row) async {
    received.add(row);
    return DispatchSuccess(
      serverEntity: <String, dynamic>{'id': row.entityId},
      serverVersion: 'v1',
      serverEntityId: row.entityId,
    );
  }
}

Future<void> _waitFor(Future<bool> Function() condition) async {
  final DateTime deadline = DateTime.now().add(const Duration(seconds: 5));
  while (DateTime.now().isBefore(deadline)) {
    if (await condition()) return;
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
  fail('condition not met within 5s');
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
    final Directory tempDir = await Directory.systemTemp.createTemp(
      'sync_triggers_',
    );
    final AppDatabase db = AppDatabase(
      overridePath: '${tempDir.path}/openemis.db',
    );
    final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
    await secure.writeTenant(tenantId: 'tenant-a', displayName: 'Tenant A');
    final TenantProvider tenant = TenantProvider(secure);
    await tenant.bootstrap();
    return (db: db, tenant: tenant);
  }

  SyncEngine buildEngine(
    ({AppDatabase db, TenantProvider tenant}) ctx,
    FakeConnectivityMonitor connectivity,
    SyncDispatcher dispatcher,
  ) {
    return SyncEngine(
      database: ctx.db,
      tenantProvider: ctx.tenant,
      connectivity: connectivity,
      dispatchers: <SyncEntityType, SyncDispatcher>{
        SyncEntityType.attendance: dispatcher,
      },
      baseBackoff: Duration.zero,
    );
  }

  test(
    'mark while already online dispatches without a connectivity event',
    () async {
      final ({AppDatabase db, TenantProvider tenant}) ctx = await bootstrap();
      final FakeConnectivityMonitor connectivity = FakeConnectivityMonitor(
        startsOnline: true,
      );
      final _SuccessDispatcher dispatcher = _SuccessDispatcher();
      final SyncEngine engine = buildEngine(ctx, connectivity, dispatcher);
      engine.start();

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
        syncPayload: const <String, dynamic>{'status': 'PRESENT'},
        entityId: 'att-1',
      );

      // No connectivity.emit(...) anywhere in this test.
      await _waitFor(() async => await engine.pendingCount() == 0);
      expect(dispatcher.received, hasLength(1));

      await engine.stop();
      await ctx.db.close();
    },
  );

  test('rows queued before launch are flushed on start while online', () async {
    final ({AppDatabase db, TenantProvider tenant}) ctx = await bootstrap();
    final FakeConnectivityMonitor connectivity = FakeConnectivityMonitor(
      startsOnline: true,
    );
    final _SuccessDispatcher dispatcher = _SuccessDispatcher();

    // "Previous launch": queue a row with an engine that never starts.
    final SyncEngine previous = buildEngine(ctx, connectivity, dispatcher);
    await previous.enqueue(
      entityType: SyncEntityType.attendance,
      operation: SyncOperation.create,
      syncPayload: const <String, dynamic>{'status': 'ABSENT'},
      entityId: 'att-2',
    );
    expect(await previous.pendingCount(), 1);
    expect(dispatcher.received, isEmpty);

    // "Restart": a fresh engine starts while already online.
    final SyncEngine engine = buildEngine(ctx, connectivity, dispatcher);
    engine.start();

    await _waitFor(() async => await engine.pendingCount() == 0);
    expect(dispatcher.received, hasLength(1));
    expect(dispatcher.received.single.entityId, 'att-2');

    await engine.stop();
    await ctx.db.close();
  });
}
