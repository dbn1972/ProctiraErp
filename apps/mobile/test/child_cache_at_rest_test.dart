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
import 'package:proctira_mobile/features/students/data/student_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class _NoopDispatcher implements SyncDispatcher {
  const _NoopDispatcher();

  @override
  Future<DispatchOutcome> dispatch(PendingSyncRow row) async {
    return const DispatchTransient('test offline');
  }
}

/// W2-MOB-01: child PII must not persist as plaintext in the on-disk SQLite file.
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
    'students_cache does not persist child full_name or national_id as plaintext',
    () async {
      final Directory tempDir =
          await Directory.systemTemp.createTemp('w2_mob_01_');
      final String dbPath = '${tempDir.path}/openemis_mobile.db';

      final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
      await secure.writeTenant(tenantId: 'tenant-child', displayName: 'School');
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

      final StudentRepository repo = StudentRepository(
        database: db,
        tenantProvider: tenant,
        syncEngine: engine,
        cacheCrypto: crypto,
      );

      const String childName = 'Alice Vulnerable-Child';
      const String nationalId = 'NAT-SECRET-CHILD-999';

      await repo.cacheStudent(
        const Student(
          id: 'stu-child-1',
          firstName: 'Alice',
          lastName: 'Vulnerable-Child',
          nationalId: nationalId,
          institutionId: 'inst-1',
          dateOfBirth: '2014-05-01',
          gender: 'F',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        ),
      );

      await db.close();

      final Uint8List bytes = await File(dbPath).readAsBytes();
      final String latin1 = String.fromCharCodes(bytes);

      expect(
        latin1.contains(childName),
        isFalse,
        reason: 'child full_name must not appear as plaintext in the DB file',
      );
      expect(
        latin1.contains(nationalId),
        isFalse,
        reason: 'national_id must not appear as plaintext in the DB file',
      );
      expect(
        latin1.contains('2014-05-01'),
        isFalse,
        reason: 'date of birth must not appear as plaintext in the payload',
      );

      final AppDatabase db2 = AppDatabase(overridePath: dbPath);
      final StudentRepository repo2 = StudentRepository(
        database: db2,
        tenantProvider: tenant,
        syncEngine: SyncEngine(
          database: db2,
          tenantProvider: tenant,
          connectivity: FakeConnectivityMonitor(),
          dispatchers: const <SyncEntityType, SyncDispatcher>{},
          baseBackoff: Duration.zero,
        ),
        cacheCrypto: crypto,
      );
      final List<CachedStudent> found = await repo2.searchStudents(
        query: 'Alice',
        seedFromApi: false,
      );
      expect(found, isNotEmpty);
      expect(found.first.fullName, childName);
      expect(found.first.nationalId, nationalId);
      await db2.close();
    },
  );
}
