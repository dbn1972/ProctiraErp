import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:proctira_mobile/core/auth/auth_bloc.dart';
import 'package:proctira_mobile/core/storage/cache_crypto.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/sync/connectivity_monitor.dart';
import 'package:proctira_mobile/core/sync/sync_dispatcher.dart';
import 'package:proctira_mobile/core/sync/sync_engine.dart';
import 'package:proctira_mobile/core/sync/sync_models.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/students/data/student_repository.dart';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class _NoopDispatcher implements SyncDispatcher {
  const _NoopDispatcher();

  @override
  Future<DispatchOutcome> dispatch(PendingSyncRow row) async {
    return const DispatchTransient('test offline');
  }
}

/// W2-MOB-02: logout must purge offline caches so a shared device cannot
/// surface the previous user's child data after tokens are cleared.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  test(
    'AuthLogoutRequested deletes students_cache rows and clears tenant',
    () async {
      final Directory tempDir =
          await Directory.systemTemp.createTemp('w2_mob_02_');
      final String dbPath = '${tempDir.path}/openemis_mobile.db';

      final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
      await secure.writeTokens(
        accessToken: 'access-prior',
        refreshToken: 'refresh-prior',
      );
      await secure.writeTenant(
        tenantId: 'tenant-prior',
        displayName: 'Prior School',
      );
      final CacheCrypto crypto = await CacheCrypto.fromSecureStorage(secure);

      final AppDatabase db = AppDatabase(overridePath: dbPath);
      final TenantProvider tenant = TenantProvider(secure);
      await tenant.bootstrap();
      final SyncEngine engine = SyncEngine(
        database: db,
        tenantProvider: tenant,
        connectivity: FakeConnectivityMonitor(),
        dispatchers: const <SyncEntityType, SyncDispatcher>{
          SyncEntityType.student: _NoopDispatcher(),
        },
        baseBackoff: Duration.zero,
      );

      final StudentRepository students = StudentRepository(
        database: db,
        tenantProvider: tenant,
        syncEngine: engine,
        cacheCrypto: crypto,
      );
      await students.cacheStudent(
        const Student(
          id: 'stu-prior-1',
          firstName: 'Prior',
          lastName: 'Child',
          nationalId: 'NAT-PRIOR-1',
          institutionId: 'inst-1',
          dateOfBirth: '2015-01-01',
          gender: 'F',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        ),
      );

      final Database raw = await db.database;
      final int before = Sqflite.firstIntValue(
            await raw.rawQuery('SELECT COUNT(*) AS c FROM students_cache'),
          ) ??
          0;
      expect(before, greaterThan(0));

      final AuthBloc auth = AuthBloc(
        secureStorage: secure,
        database: db,
      );
      auth.add(const AuthLogoutRequested());
      await auth.stream.firstWhere(
        (AuthState s) => s.status == AuthStatus.unauthenticated,
      );

      final int after = Sqflite.firstIntValue(
            await raw.rawQuery('SELECT COUNT(*) AS c FROM students_cache'),
          ) ??
          -1;
      expect(after, 0, reason: 'logout must wipe students_cache');
      expect(await secure.readAccessToken(), isNull);
      expect(await secure.readRefreshToken(), isNull);
      expect(await secure.readTenantId(), isNull);

      await auth.close();
      await db.close();
    },
  );
}
