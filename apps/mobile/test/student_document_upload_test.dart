// PRC-H016: captured student documents reach the server as file bytes via
// POST /api/v1/students/:id/documents and failures stay visible.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:proctira_mobile/core/storage/cache_crypto.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/sync/connectivity_monitor.dart';
import 'package:proctira_mobile/core/sync/student_document_dispatcher.dart';
import 'package:proctira_mobile/core/sync/sync_dispatcher.dart';
import 'package:proctira_mobile/core/sync/sync_engine.dart';
import 'package:proctira_mobile/core/sync/sync_models.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/students/data/student_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Records requests and answers like the students-360 document route.
class _FakeServerAdapter implements HttpClientAdapter {
  _FakeServerAdapter({this.status = 201});
  int status;
  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final Map<String, dynamic> body = status == 201
        ? <String, dynamic>{
            'id': '9b2f7a36-0000-4000-8000-000000000001',
            'studentId': 'stu-1',
            'category': (options.data as Map<String, dynamic>)['category'],
            'fileName': (options.data as Map<String, dynamic>)['fileName'],
            'mimeType': 'image/jpeg',
            'sizeBytes': 4,
            'uploadedBy': 'teacher-1',
            'createdAt': '2026-05-12T10:00:00.000Z',
          }
        : <String, dynamic>{'code': 'FORBIDDEN', 'message': 'Forbidden'};
    return ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>[Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

typedef _Ctx = ({
  AppDatabase db,
  SyncEngine engine,
  StudentRepository repo,
  FakeConnectivityMonitor connectivity,
  _FakeServerAdapter server,
  Directory dir,
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

  Future<_Ctx> bootstrap({int status = 201}) async {
    final Directory dir = await Directory.systemTemp.createTemp('doc_upload_');
    final AppDatabase db = AppDatabase(overridePath: '${dir.path}/o.db');
    final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
    await secure.writeTenant(tenantId: 'tenant-a', displayName: 'A');
    final CacheCrypto crypto = await CacheCrypto.fromSecureStorage(secure);
    final TenantProvider tenant = TenantProvider(secure);
    await tenant.bootstrap();
    final _FakeServerAdapter server = _FakeServerAdapter(status: status);
    final Dio dio = Dio(BaseOptions(baseUrl: 'https://api.test'))
      ..httpClientAdapter = server;
    final FakeConnectivityMonitor connectivity = FakeConnectivityMonitor();
    final SyncEngine engine = SyncEngine(
      database: db,
      tenantProvider: tenant,
      connectivity: connectivity,
      dispatchers: <SyncEntityType, SyncDispatcher>{
        SyncEntityType.student: StudentDocumentSyncDispatcher(StudentApi(dio)),
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
      'payload': await crypto.encrypt('{"id":"stu-1"}'),
      'updated_at': 1,
      'version': 'v-1',
    });
    final StudentRepository repo = StudentRepository(
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
      dir: dir,
    );
  }

  Future<void> waitUntil(Future<bool> Function() cond) async {
    final DateTime deadline = DateTime.now().add(const Duration(seconds: 5));
    while (!await cond()) {
      if (DateTime.now().isAfter(deadline)) fail('timed out');
      await Future<void>.delayed(const Duration(milliseconds: 20));
    }
  }

  test(
    'capture offline, reconnect -> server receives the file bytes',
    () async {
      final _Ctx ctx = await bootstrap();
      final File scan = File('${ctx.dir.path}/scan.jpg');
      await scan.writeAsBytes(<int>[0xFF, 0xD8, 0xFF, 0xD9]);
      ctx.engine.start(); // offline: nothing is sent yet

      await ctx.repo.attachDocument(studentId: 'stu-1', filePath: scan.path);
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(ctx.server.requests, isEmpty);
      final PendingSyncRow queued = (await ctx.engine.getPending()).single;

      ctx.connectivity.emit(true);
      await waitUntil(() async => (await ctx.engine.getPending()).isEmpty);

      final RequestOptions req = ctx.server.requests.single;
      expect(req.method, 'POST');
      expect(req.path, '/api/v1/students/stu-1/documents');
      expect(req.headers['Idempotency-Key'], queued.idempotencyKey);
      final Map<String, dynamic> body = req.data as Map<String, dynamic>;
      expect(base64Decode(body['contentBase64'] as String), <int>[
        0xFF,
        0xD8,
        0xFF,
        0xD9,
      ]);
      expect(body['fileName'], 'scan.jpg');
      expect(body['mimeType'], 'image/jpeg');
      expect(body['category'], 'other');
      // On-device copy removed once the server holds it.
      expect(await scan.exists(), isFalse);

      await ctx.engine.stop();
      await ctx.db.close();
    },
  );

  test(
    'server rejection parks the upload and it is counted as failed',
    () async {
      final _Ctx ctx = await bootstrap(status: 403);
      final File scan = File('${ctx.dir.path}/scan.jpg');
      await scan.writeAsBytes(<int>[1, 2, 3]);
      await ctx.repo.attachDocument(studentId: 'stu-1', filePath: scan.path);
      ctx.connectivity.emit(true);

      final SyncFlushResult r = await ctx.engine.flushPending();
      expect(r.parked, 1);
      expect((await ctx.engine.queueSummary()).parked, 1);
      // Kept on device so a retry can still upload it.
      expect(await scan.exists(), isTrue);

      ctx.server.status = 201;
      await ctx.engine.retryParked();
      await ctx.engine.flushPending();
      expect((await ctx.engine.queueSummary()).isEmpty, isTrue);
      await ctx.db.close();
    },
  );

  test('missing file is parked with an explicit reason', () async {
    final _Ctx ctx = await bootstrap();
    await ctx.repo.attachDocument(
      studentId: 'stu-1',
      filePath: '${ctx.dir.path}/gone.jpg',
    );
    ctx.connectivity.emit(true);
    await ctx.engine.flushPending();
    final PendingSyncRow row = (await ctx.engine.getPending()).single;
    expect(row.status, SyncStatus.parked);
    expect(row.lastError, contains('no longer on this device'));
    expect(ctx.server.requests, isEmpty);
    await ctx.db.close();
  });
}
