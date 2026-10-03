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
import 'package:proctira_mobile/features/students/data/student_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/fake_student_api.dart';

Future<StudentRepository> _repo(FakeStudentApi api) async {
  final Directory tempDir = await Directory.systemTemp.createTemp('stu_ref_');
  final AppDatabase db = AppDatabase(overridePath: '${tempDir.path}/s.db');
  final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
  await secure.writeTenant(tenantId: 'tenant-a', displayName: 'Tenant A');
  final CacheCrypto crypto = await CacheCrypto.fromSecureStorage(secure);
  final TenantProvider tenant = TenantProvider(secure);
  await tenant.bootstrap();
  final SyncEngine engine = SyncEngine(
    database: db,
    tenantProvider: tenant,
    connectivity: FakeConnectivityMonitor(),
    dispatchers: const <SyncEntityType, SyncDispatcher>{},
    baseBackoff: Duration.zero,
  );
  return StudentRepository(
    database: db,
    tenantProvider: tenant,
    syncEngine: engine,
    cacheCrypto: crypto,
    studentApi: api,
  );
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

  test('PRC-M042: 120 remote students are all searchable after sync', () async {
    final FakeStudentApi api = FakeStudentApi(<Student>[
      for (int i = 0; i < 120; i++) fakeStudent(i),
    ]);
    final StudentRepository repo = await _repo(api);
    final List<CachedStudent> all = await repo.searchStudents(limit: 500);
    expect(all, hasLength(120));
    expect(api.requestedPages, <int>[1, 2]);
    final List<CachedStudent> last = await repo.searchStudents(query: '119');
    expect(last.single.id, 'stu-119');
  });

  test('PRC-M042: removed student disappears after refresh', () async {
    final FakeStudentApi api = FakeStudentApi(<Student>[
      fakeStudent(1),
      fakeStudent(2),
    ]);
    final StudentRepository repo = await _repo(api);
    expect(await repo.searchStudents(), hasLength(2));
    api.students = <Student>[fakeStudent(2), fakeStudent(3)];
    await repo.refreshFromServer();
    final List<CachedStudent> after = await repo.searchStudents();
    expect(
      after.map((CachedStudent s) => s.id),
      unorderedEquals(<String>['stu-2', 'stu-3']),
    );
  });

  test('PRC-M043: 403 propagates instead of an empty roster', () async {
    final FakeStudentApi api = FakeStudentApi(<Student>[])
      ..failWith = const PermanentApiException('Forbidden', statusCode: 403);
    final StudentRepository repo = await _repo(api);
    await expectLater(
      repo.searchStudents(),
      throwsA(isA<PermanentApiException>()),
    );
  });

  test('PRC-M043: connection error serves the cache', () async {
    final FakeStudentApi api = FakeStudentApi(<Student>[])
      ..failWith = const TransientApiException('offline');
    final StudentRepository repo = await _repo(api);
    expect(await repo.searchStudents(), isEmpty);
  });
}
