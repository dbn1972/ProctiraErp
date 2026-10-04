// PRC-H016: DocumentService copies scans into app storage before queueing.
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/storage/cache_crypto.dart';
import 'package:proctira_mobile/core/storage/captured_document_store.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/sync/connectivity_monitor.dart';
import 'package:proctira_mobile/core/sync/student_document_dispatcher.dart';
import 'package:proctira_mobile/core/sync/sync_dispatcher.dart';
import 'package:proctira_mobile/core/sync/sync_engine.dart';
import 'package:proctira_mobile/core/sync/sync_models.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/students/data/document_service.dart';
import 'package:proctira_mobile/features/students/data/student_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  Future<
    ({AppDatabase db, SyncEngine engine, DocumentService svc, Directory dir})
  >
  build({bool seedStudent = true}) async {
    final Directory dir = await Directory.systemTemp.createTemp('doc_svc_');
    final AppDatabase db = AppDatabase(overridePath: '${dir.path}/o.db');
    final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
    await secure.writeTenant(tenantId: 'tenant-a', displayName: 'A');
    final CacheCrypto crypto = await CacheCrypto.fromSecureStorage(secure);
    final TenantProvider tenant = TenantProvider(secure);
    await tenant.bootstrap();
    final SyncEngine engine = SyncEngine(
      database: db,
      tenantProvider: tenant,
      connectivity: FakeConnectivityMonitor(),
      dispatchers: const <SyncEntityType, SyncDispatcher>{},
    );
    if (seedStudent) {
      await (await db.database).insert('students_cache', <String, Object?>{
        'id': 'stu-1',
        'tenant_id': 'tenant-a',
        'institution_id': 'inst-1',
        'full_name': await crypto.encrypt('Ada Lovelace'),
        'national_id': null,
        'grade': null,
        'class_name': null,
        'payload': await crypto.encrypt('{"id":"stu-1"}'),
        'updated_at': 1,
      });
    }
    final DocumentService svc = DocumentService(
      StudentRepository(
        database: db,
        tenantProvider: tenant,
        syncEngine: engine,
        cacheCrypto: crypto,
      ),
      store: CapturedDocumentStore(
        crypto: crypto,
        dir: () async => Directory('${dir.path}/pending_documents'),
      ),
    );
    return (db: db, engine: engine, svc: svc, dir: dir);
  }

  test('copies the scan to app storage and queues the copy', () async {
    final ctx = await build();
    final File picked = File('${ctx.dir.path}/IMG_1.JPG');
    await picked.writeAsBytes(<int>[1, 2, 3, 4]);

    final DocumentUploadResult result = await ctx.svc.uploadCapturedDocument(
      studentId: 'stu-1',
      filePath: picked.path,
      category: 'birth_certificate',
    );

    expect(result.queued, isTrue);
    expect(result.filePath, startsWith('${ctx.dir.path}/pending_documents/'));
    expect(await File(result.filePath).readAsBytes(), isNot(<int>[1, 2, 3, 4]));
    expect(await picked.exists(), isFalse, reason: 'picker temp deleted');
    final PendingSyncRow row = (await ctx.engine.getPending()).single;
    expect(row.payload['filePath'], result.filePath);
    expect(row.payload['category'], 'birth_certificate');
    await ctx.db.close();
  });

  test('student missing from cache: nothing queued, no orphan copy', () async {
    final ctx = await build(seedStudent: false);
    final File picked = File('${ctx.dir.path}/a.jpg');
    await picked.writeAsBytes(<int>[1]);
    final DocumentUploadResult result = await ctx.svc.uploadCapturedDocument(
      studentId: 'stu-1',
      filePath: picked.path,
    );
    expect(result.queued, isFalse);
    expect(await File(result.filePath).exists(), isFalse);
    expect(await ctx.engine.getPending(), isEmpty);
    await ctx.db.close();
  });

  test('files above the backend limit are rejected before queueing', () async {
    final ctx = await build();
    final File picked = File('${ctx.dir.path}/big.jpg');
    await picked.writeAsBytes(Uint8List(kMaxStudentDocumentBytes + 1));
    final DocumentUploadResult result = await ctx.svc.uploadCapturedDocument(
      studentId: 'stu-1',
      filePath: picked.path,
    );
    expect(result.queued, isFalse);
    expect(result.rejectedReason, isNotNull);
    expect(await ctx.engine.getPending(), isEmpty);
    await ctx.db.close();
  });
}
