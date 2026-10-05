import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/auth/auth_bloc.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/student/selected_student_store.dart';
import 'package:proctira_mobile/core/sync/connectivity_monitor.dart';
import 'package:proctira_mobile/core/sync/sync_dispatcher.dart';
import 'package:proctira_mobile/core/sync/sync_engine.dart';
import 'package:proctira_mobile/core/sync/sync_models.dart';
import 'package:proctira_mobile/core/sync/unsynced_work.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// PRC-M034: workspace switch and logout clear in-memory tenant, tokens,
/// selected student and caches.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });
  setUp(() => FlutterSecureStorage.setMockInitialValues(<String, String>{}));

  Future<
    ({
      SecureStorage secure,
      TenantProvider tenant,
      SelectedStudentStore student,
      AppDatabase db,
      AuthBloc auth,
    })
  >
  seed() async {
    final Directory dir = await Directory.systemTemp.createTemp('m034_');
    final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
    await secure.writeTokens(accessToken: 'a-old', refreshToken: 'r-old');
    final TenantProvider tenant = TenantProvider(secure);
    await tenant.setTenant(tenantId: 'tenant-old', displayName: 'Old');
    final SelectedStudentStore student = SelectedStudentStore(secure);
    await student.select(id: 'stu-old', displayName: 'Old Child');
    final AppDatabase db = AppDatabase(overridePath: '${dir.path}/m034.db');
    final Database raw = await db.database;
    await raw.insert('notifications_cache', <String, Object?>{
      'id': 'n1',
      'tenant_id': 'tenant-old',
      'title': 't',
      'body': 'b',
      'received_at': 1,
      'read': 0,
    });
    final AuthBloc auth = AuthBloc(
      secureStorage: secure,
      database: db,
      selectedStudent: student,
      tenantProvider: tenant,
    );
    return (
      secure: secure,
      tenant: tenant,
      student: student,
      db: db,
      auth: auth,
    );
  }

  Future<int> count(AppDatabase db, String table) async =>
      Sqflite.firstIntValue(
        await (await db.database).rawQuery('SELECT COUNT(*) FROM $table'),
      ) ??
      -1;

  test('switch tenant clears tokens, student, caches; activates new', () async {
    final ctx = await seed();
    ctx.auth.add(const AuthWorkspaceSwitchRequested(tenantId: 'tenant-new'));
    await ctx.auth.stream.firstWhere(
      (AuthState s) => s.status == AuthStatus.unauthenticated,
    );
    expect(await ctx.secure.readAccessToken(), isNull);
    expect(await ctx.secure.readRefreshToken(), isNull);
    expect(ctx.student.hasStudent, isFalse);
    expect(await ctx.secure.readSelectedStudentId(), isNull);
    expect(await count(ctx.db, 'notifications_cache'), 0);
    expect(ctx.tenant.tenantId, 'tenant-new');
    expect(ctx.tenant.displayName, isNot('Old'));
    expect(await ctx.secure.readTenantId(), 'tenant-new');
    await ctx.auth.close();
    await ctx.db.close();
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
        'id': 'att-1',
        'tenant_id': 'tenant-old',
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
  }

  test('a queued offline mark blocks the switch; nothing is purged', () async {
    final ctx = await seed();
    await queueOfflineMark(ctx.db, ctx.tenant);

    ctx.auth.add(const AuthWorkspaceSwitchRequested(tenantId: 'tenant-new'));
    final AuthState refused = await ctx.auth.stream.firstWhere(
      (AuthState s) => s.blockedWorkspaceSwitch != null,
    );

    expect(refused.blockedWorkspaceSwitch!.isEmpty, isFalse);
    expect(refused.blockedWorkspaceSwitch!.queuedChanges, 1);
    expect(await count(ctx.db, 'pending_sync'), 1);
    expect(await count(ctx.db, 'attendance_offline'), 1);
    expect(await ctx.secure.readAccessToken(), 'a-old');
    expect(ctx.student.hasStudent, isTrue);
    expect(ctx.tenant.tenantId, 'tenant-old');
    await ctx.auth.close();
    await ctx.db.close();
  });

  test('explicit discard purges the queued mark and switches', () async {
    final ctx = await seed();
    await queueOfflineMark(ctx.db, ctx.tenant);

    ctx.auth.add(
      const AuthWorkspaceSwitchRequested(
        tenantId: 'tenant-new',
        discardUnsyncedWork: true,
      ),
    );
    await ctx.auth.stream.firstWhere(
      (AuthState s) => s.status == AuthStatus.unauthenticated,
    );

    expect(await count(ctx.db, 'pending_sync'), 0);
    expect(await count(ctx.db, 'attendance_offline'), 0);
    expect(await ctx.secure.readAccessToken(), isNull);
    expect(ctx.tenant.tenantId, 'tenant-new');
    await ctx.auth.close();
    await ctx.db.close();
  });

  test('queue drained by the pre-switch flush lets the switch go ahead', () async {
    final ctx = await seed();
    await ctx.auth.close();
    await queueOfflineMark(ctx.db, ctx.tenant);
    int flushes = 0;
    final AuthBloc auth = AuthBloc(
      secureStorage: ctx.secure,
      database: ctx.db,
      selectedStudent: ctx.student,
      tenantProvider: ctx.tenant,
      flushPendingWork: () async {
        // Simulates a successful sync of the queued mark.
        flushes += 1;
        final Database raw = await ctx.db.database;
        await raw.delete('pending_sync');
        await raw.update('attendance_offline', <String, Object?>{'synced': 1});
      },
    );

    auth.add(const AuthWorkspaceSwitchRequested(tenantId: 'tenant-new'));
    final AuthState settled = await auth.stream.firstWhere(
      (AuthState s) =>
          s.status == AuthStatus.unauthenticated ||
          s.blockedWorkspaceSwitch != null,
    );

    expect(flushes, 1);
    expect(settled.status, AuthStatus.unauthenticated);
    expect(ctx.tenant.tenantId, 'tenant-new');
    await auth.close();
    await ctx.db.close();
  });

  test('an unreadable queue fails closed', () async {
    final ctx = await seed();
    await ctx.auth.close();
    final AuthBloc auth = AuthBloc(
      secureStorage: ctx.secure,
      database: ctx.db,
      tenantProvider: ctx.tenant,
      inspectUnsyncedWork: () async => throw StateError('db closed'),
    );

    auth.add(const AuthWorkspaceSwitchRequested(tenantId: 'tenant-new'));
    final AuthState refused = await auth.stream.firstWhere(
      (AuthState s) => s.blockedWorkspaceSwitch != null,
    );

    expect(refused.blockedWorkspaceSwitch, const UnsyncedWork.unknown());
    expect(await ctx.secure.readAccessToken(), 'a-old');
    expect(ctx.tenant.tenantId, 'tenant-old');
    await auth.close();
    await ctx.db.close();
  });

  test('logout clears the in-memory tenant too', () async {
    final ctx = await seed();
    ctx.auth.add(const AuthLogoutRequested());
    await ctx.auth.stream.firstWhere(
      (AuthState s) => s.status == AuthStatus.unauthenticated,
    );
    expect(ctx.tenant.tenantId, isNull);
    expect(ctx.tenant.hasTenant, isFalse);
    expect(ctx.student.hasStudent, isFalse);
    await ctx.auth.close();
    await ctx.db.close();
  });
}
