// PRC-H010: periodic retry, app-resume and login triggers.
import 'dart:async';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/sync/connectivity_monitor.dart';
import 'package:proctira_mobile/core/sync/sync_dispatcher.dart';
import 'package:proctira_mobile/core/sync/sync_engine.dart';
import 'package:proctira_mobile/core/sync/sync_lifecycle.dart';
import 'package:proctira_mobile/core/sync/sync_models.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class _ScriptedDispatcher implements SyncDispatcher {
  _ScriptedDispatcher(this._outcomes);
  final List<DispatchOutcome> _outcomes;
  int calls = 0;

  @override
  Future<DispatchOutcome> dispatch(PendingSyncRow row) async {
    final DispatchOutcome outcome =
        _outcomes[calls.clamp(0, _outcomes.length - 1)];
    calls += 1;
    return outcome;
  }
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

  test('periodic timer retries a transient failure while online', () async {
    final Directory tempDir = await Directory.systemTemp.createTemp(
      'sync_periodic_',
    );
    final AppDatabase db = AppDatabase(
      overridePath: '${tempDir.path}/openemis.db',
    );
    final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
    await secure.writeTenant(tenantId: 'tenant-a', displayName: 'Tenant A');
    final TenantProvider tenant = TenantProvider(secure);
    await tenant.bootstrap();

    final _ScriptedDispatcher dispatcher =
        _ScriptedDispatcher(<DispatchOutcome>[
          const DispatchTransient('503'),
          const DispatchSuccess(
            serverEntity: <String, dynamic>{},
            serverVersion: 'v1',
            serverEntityId: 'att-1',
          ),
        ]);
    final SyncEngine engine = SyncEngine(
      database: db,
      tenantProvider: tenant,
      connectivity: FakeConnectivityMonitor(startsOnline: true),
      dispatchers: <SyncEntityType, SyncDispatcher>{
        SyncEntityType.attendance: dispatcher,
      },
      baseBackoff: Duration.zero,
      flushInterval: const Duration(milliseconds: 50),
    );
    engine.start();
    await engine.enqueue(
      entityType: SyncEntityType.attendance,
      operation: SyncOperation.create,
      syncPayload: const <String, dynamic>{'status': 'PRESENT'},
      entityId: 'att-1',
    );

    final DateTime deadline = DateTime.now().add(const Duration(seconds: 5));
    while (await engine.pendingCount() > 0 &&
        DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(milliseconds: 20));
    }
    expect(await engine.pendingCount(), 0);
    expect(dispatcher.calls, 2);

    await engine.stop();
    await db.close();
  });

  test('requestFlush is ignored until the engine is started', () async {
    final Directory tempDir = await Directory.systemTemp.createTemp(
      'sync_request_',
    );
    final AppDatabase db = AppDatabase(
      overridePath: '${tempDir.path}/openemis.db',
    );
    final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
    await secure.writeTenant(tenantId: 'tenant-a', displayName: 'Tenant A');
    final TenantProvider tenant = TenantProvider(secure);
    await tenant.bootstrap();
    final _ScriptedDispatcher dispatcher = _ScriptedDispatcher(
      <DispatchOutcome>[const DispatchTransient('x')],
    );
    final SyncEngine engine = SyncEngine(
      database: db,
      tenantProvider: tenant,
      connectivity: FakeConnectivityMonitor(startsOnline: true),
      dispatchers: <SyncEntityType, SyncDispatcher>{
        SyncEntityType.attendance: dispatcher,
      },
    );
    await engine.enqueue(
      entityType: SyncEntityType.attendance,
      operation: SyncOperation.create,
      syncPayload: const <String, dynamic>{},
      entityId: 'att-1',
    );
    engine.requestFlush();
    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(dispatcher.calls, 0);
    await db.close();
  });

  group('SyncLifecycleFlusher', () {
    test('flushes on login and on resume only while authenticated', () async {
      final StreamController<bool> auth = StreamController<bool>();
      int flushes = 0;
      final SyncLifecycleFlusher flusher = SyncLifecycleFlusher(
        onFlush: () => flushes += 1,
        authenticatedStream: auth.stream,
      )..attach();

      // Resume while logged out: nothing.
      flusher.didChangeAppLifecycleState(AppLifecycleState.resumed);
      expect(flushes, 0);

      auth.add(true); // login / restored session
      await Future<void>.delayed(Duration.zero);
      expect(flushes, 1);

      auth.add(true); // token refresh etc. is not a new login
      await Future<void>.delayed(Duration.zero);
      expect(flushes, 1);

      flusher.didChangeAppLifecycleState(AppLifecycleState.paused);
      expect(flushes, 1);
      flusher.didChangeAppLifecycleState(AppLifecycleState.resumed);
      expect(flushes, 2);

      auth.add(false);
      await Future<void>.delayed(Duration.zero);
      flusher.didChangeAppLifecycleState(AppLifecycleState.resumed);
      expect(flushes, 2);

      await flusher.detach();
      await auth.close();
    });

    test('flushes immediately when attached with a restored session', () {
      int flushes = 0;
      SyncLifecycleFlusher(
        onFlush: () => flushes += 1,
        authenticatedStream: const Stream<bool>.empty(),
        initiallyAuthenticated: true,
      ).attach();
      expect(flushes, 1);
    });
  });
}
