import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
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

/// [StudentApi] backed by an in-process [Dio] adapter that throws on every
/// request. The repository must never invoke this when the cache has rows.
class _ExplodingHttpAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    throw StateError(
      'StudentApi must not be invoked when the cache has rows '
      '(intercepted ${options.method} ${options.path}).',
    );
  }

  @override
  void close({bool force = false}) {}
}

StudentApi _buildExplodingStudentApi() {
  final Dio dio = Dio(BaseOptions(baseUrl: 'http://localhost'));
  dio.httpClientAdapter = _ExplodingHttpAdapter();
  return StudentApi(dio);
}

Future<({AppDatabase db, TenantProvider tenant, SyncEngine engine})> _bootstrap() async {
  final Directory tempDir =
      await Directory.systemTemp.createTemp('students_repo_');
  final AppDatabase db = AppDatabase(overridePath: '${tempDir.path}/openemis.db');
  final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
  await secure.writeTenant(tenantId: 'tenant-a', displayName: 'Tenant A');
  final TenantProvider tenant = TenantProvider(secure);
  await tenant.bootstrap();
  final FakeConnectivityMonitor connectivity = FakeConnectivityMonitor();
  final SyncEngine engine = SyncEngine(
    database: db,
    tenantProvider: tenant,
    connectivity: connectivity,
    dispatchers: const <SyncEntityType, SyncDispatcher>{
      SyncEntityType.student: _NoopDispatcher(),
    },
    baseBackoff: Duration.zero,
  );
  return (db: db, tenant: tenant, engine: engine);
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

  test(
    'searchStudents returns cached rows without invoking the api',
    () async {
      final ({AppDatabase db, TenantProvider tenant, SyncEngine engine}) ctx =
          await _bootstrap();
      final Database raw = await ctx.db.database;
      await raw.insert('students_cache', <String, Object?>{
        'id': 'stu-1',
        'tenant_id': 'tenant-a',
        'institution_id': 'inst-1',
        'full_name': 'Ada Lovelace',
        'national_id': 'A1',
        'grade': null,
        'class_name': null,
        'payload':
            '{"id":"stu-1","firstName":"Ada","lastName":"Lovelace","dateOfBirth":"1815-12-10","gender":"F","nationalId":"A1","institutionId":"inst-1","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}',
        'updated_at': 1,
      });

      final StudentRepository repo = StudentRepository(
        database: ctx.db,
        tenantProvider: ctx.tenant,
        syncEngine: ctx.engine,
        studentApi: _buildExplodingStudentApi(),
      );

      final List<CachedStudent> rows = await repo.searchStudents();
      expect(rows, hasLength(1));
      expect(rows.first.id, 'stu-1');
      expect(rows.first.fullName, 'Ada Lovelace');
      expect(rows.first.dateOfBirth, '1815-12-10');

      // Targeted search by name.
      final List<CachedStudent> filtered =
          await repo.searchStudents(query: 'lov');
      expect(filtered, hasLength(1));

      final List<CachedStudent> empty =
          await repo.searchStudents(query: 'no-match');
      expect(empty, isEmpty);

      await ctx.db.close();
    },
  );

  test('attachDocument persists the path and queues a student.update op',
      () async {
    final ({AppDatabase db, TenantProvider tenant, SyncEngine engine}) ctx =
        await _bootstrap();
    final Database raw = await ctx.db.database;
    await raw.insert('students_cache', <String, Object?>{
      'id': 'stu-1',
      'tenant_id': 'tenant-a',
      'institution_id': 'inst-1',
      'full_name': 'Ada Lovelace',
      'national_id': 'A1',
      'grade': null,
      'class_name': null,
      'payload':
          '{"id":"stu-1","firstName":"Ada","lastName":"Lovelace","institutionId":"inst-1","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}',
      'updated_at': 1,
      'version': 'v-1',
    });

    final StudentRepository repo = StudentRepository(
      database: ctx.db,
      tenantProvider: ctx.tenant,
      syncEngine: ctx.engine,
      studentApi: _buildExplodingStudentApi(),
    );

    final CachedStudent? saved = await repo.attachDocument(
      studentId: 'stu-1',
      filePath: '/tmp/photo.jpg',
    );
    expect(saved, isNotNull);
    expect(saved!.documents, contains('/tmp/photo.jpg'));

    final List<PendingSyncRow> queue = await ctx.engine.getPending();
    expect(queue, hasLength(1));
    expect(queue.first.entityType, SyncEntityType.student);
    expect(queue.first.operation, SyncOperation.update);
    expect(queue.first.entityId, 'stu-1');
    expect(queue.first.baseVersion, 'v-1');
    expect(queue.first.payload['documents'], contains('/tmp/photo.jpg'));

    await ctx.db.close();
  });

  test('getStudent returns null when no cached row exists', () async {
    final ({AppDatabase db, TenantProvider tenant, SyncEngine engine}) ctx =
        await _bootstrap();
    final StudentRepository repo = StudentRepository(
      database: ctx.db,
      tenantProvider: ctx.tenant,
      syncEngine: ctx.engine,
      studentApi: _buildExplodingStudentApi(),
    );
    expect(await repo.getStudent('does-not-exist'), isNull);
    await ctx.db.close();
  });
}
