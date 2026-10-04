// PRC-H012: editing an attendance mark before its create has synced must not
// strand the edit (previously an update with a null base version was parked
// permanently and the server kept the first status).
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

/// In-memory stand-in for the attendance API with the same If-Match rules as
/// [AttendanceSyncDispatcher]: updates without a base version are rejected.
class _FakeAttendanceServer implements SyncDispatcher {
  final Map<String, String> statusById = <String, String>{};
  final Map<String, int> versionById = <String, int>{};
  final List<PendingSyncRow> received = <PendingSyncRow>[];
  int transientCreatesRemaining = 0;
  Future<void> Function()? onCreate;

  @override
  Future<DispatchOutcome> dispatch(PendingSyncRow row) async {
    received.add(row);
    final String id = row.entityId!;
    switch (row.operation) {
      case SyncOperation.create:
        if (transientCreatesRemaining > 0) {
          transientCreatesRemaining -= 1;
          return const DispatchTransient('503');
        }
        final Future<void> Function()? hook = onCreate;
        onCreate = null;
        if (hook != null) await hook();
        statusById[id] = row.payload['status'] as String;
        versionById[id] = 1;
        return DispatchSuccess(
          serverEntity: <String, dynamic>{'id': id},
          serverVersion: 'srv-$id-1',
          serverEntityId: id,
        );
      case SyncOperation.update:
        if (row.baseVersion == null) {
          return const DispatchPermanent('Update missing base version');
        }
        if (row.baseVersion != 'srv-$id-${versionById[id]}') {
          return const DispatchConflict();
        }
        statusById[id] = row.payload['status'] as String;
        versionById[id] = versionById[id]! + 1;
        return DispatchSuccess(
          serverEntity: <String, dynamic>{'id': id},
          serverVersion: 'srv-$id-${versionById[id]}',
        );
      case SyncOperation.delete:
        return const DispatchPermanent('unsupported');
    }
  }
}

typedef _Ctx = ({
  AppDatabase db,
  SyncEngine engine,
  AttendanceRepository repo,
  FakeConnectivityMonitor connectivity,
  _FakeAttendanceServer server,
});

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  Future<_Ctx> bootstrap() async {
    final Directory tempDir = await Directory.systemTemp.createTemp(
      'att_edit_',
    );
    final AppDatabase db = AppDatabase(
      overridePath: '${tempDir.path}/openemis.db',
    );
    final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
    await secure.writeTenant(tenantId: 'tenant-a', displayName: 'Tenant A');
    final CacheCrypto crypto = await CacheCrypto.fromSecureStorage(secure);
    final TenantProvider tenant = TenantProvider(secure);
    await tenant.bootstrap();
    final FakeConnectivityMonitor connectivity = FakeConnectivityMonitor();
    final _FakeAttendanceServer server = _FakeAttendanceServer();
    final SyncEngine engine = SyncEngine(
      database: db,
      tenantProvider: tenant,
      connectivity: connectivity,
      dispatchers: <SyncEntityType, SyncDispatcher>{
        SyncEntityType.attendance: server,
      },
      baseBackoff: Duration.zero,
    );
    final Database raw = await db.database;
    await raw.insert('students_cache', <String, Object?>{
      'id': 'stu-1',
      'tenant_id': 'tenant-a',
      'institution_id': 'inst-1',
      'full_name': await crypto.encrypt('Ada Lovelace'),
      'national_id': null,
      'grade': null,
      'class_name': null,
      'payload': await crypto.encrypt('{}'),
      'updated_at': 1,
    });
    final AttendanceRepository repo = AttendanceRepository(
      database: db,
      tenantProvider: tenant,
      syncEngine: engine,
      cacheCrypto: crypto,
    );
    return (
      db: db,
      engine: engine,
      repo: repo,
      connectivity: connectivity,
      server: server,
    );
  }

  Future<AttendanceRosterEntry> mark(
    _Ctx ctx,
    AttendanceRosterEntry entry,
    AttendanceStatus status,
  ) {
    return ctx.repo.markAttendance(
      entry: entry,
      institutionId: 'inst-1',
      date: '2026-05-12',
      status: status,
      recordedBy: 'teacher-1',
    );
  }

  Future<AttendanceRosterEntry> firstEntry(_Ctx ctx) async =>
      (await ctx.repo.loadRoster(
        institutionId: 'inst-1',
        date: '2026-05-12',
      )).first;

  test('PRESENT then ABSENT offline -> server receives ABSENT once', () async {
    final _Ctx ctx = await bootstrap();
    final AttendanceRosterEntry a = await mark(
      ctx,
      await firstEntry(ctx),
      AttendanceStatus.present,
    );
    await mark(ctx, a, AttendanceStatus.absent);

    ctx.connectivity.emit(true);
    await ctx.engine.flushPending();

    expect(ctx.server.received, hasLength(1));
    expect(ctx.server.received.single.operation, SyncOperation.create);
    expect(ctx.server.statusById[a.recordId], 'ABSENT');
    expect(await ctx.engine.getPending(), isEmpty);

    final AttendanceRosterEntry after = await firstEntry(ctx);
    expect(after.status, AttendanceStatus.absent);
    expect(after.synced, isTrue);
    await ctx.db.close();
  });

  test(
    'edit after create synced sends If-Match with the server version',
    () async {
      final _Ctx ctx = await bootstrap();
      ctx.connectivity.emit(true);
      // Roster entry captured before the create synced (version == null).
      final AttendanceRosterEntry stale = await mark(
        ctx,
        await firstEntry(ctx),
        AttendanceStatus.present,
      );
      await ctx.engine.flushPending();
      expect(await ctx.engine.getPending(), isEmpty);

      await mark(ctx, stale, AttendanceStatus.absent);
      final List<PendingSyncRow> queued = await ctx.engine.getPending();
      expect(queued.single.operation, SyncOperation.update);
      expect(queued.single.baseVersion, 'srv-${stale.recordId}-1');

      await ctx.engine.flushPending();
      expect(ctx.server.statusById[stale.recordId], 'ABSENT');
      expect(await ctx.engine.getPending(), isEmpty);
      await ctx.db.close();
    },
  );

  test(
    'edit while the create is on the wire is replayed as an update',
    () async {
      final _Ctx ctx = await bootstrap();
      ctx.connectivity.emit(true);
      final AttendanceRosterEntry a = await mark(
        ctx,
        await firstEntry(ctx),
        AttendanceStatus.present,
      );
      ctx.server.onCreate = () async {
        await mark(ctx, a, AttendanceStatus.absent);
      };

      await ctx.engine.flushPending();
      expect(ctx.server.statusById[a.recordId], 'PRESENT');
      await ctx.engine.flushPending();

      expect(ctx.server.statusById[a.recordId], 'ABSENT');
      expect(await ctx.engine.getPending(), isEmpty);
      await ctx.db.close();
    },
  );

  test('edit after a failed create attempt waits for the create', () async {
    final _Ctx ctx = await bootstrap();
    ctx.connectivity.emit(true);
    ctx.server.transientCreatesRemaining = 1;
    final AttendanceRosterEntry a = await mark(
      ctx,
      await firstEntry(ctx),
      AttendanceStatus.present,
    );
    await ctx.engine.flushPending(); // create fails transiently
    await mark(ctx, a, AttendanceStatus.absent);

    await ctx.engine.flushPending();

    expect(ctx.server.statusById[a.recordId], 'ABSENT');
    final List<PendingSyncRow> left = await ctx.engine.getPending();
    expect(
      left.where((PendingSyncRow r) => r.status == SyncStatus.parked),
      isEmpty,
    );
    expect(left, isEmpty);
    await ctx.db.close();
  });
}
