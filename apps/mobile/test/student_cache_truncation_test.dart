import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:proctira_mobile/core/storage/cache_crypto.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/student/student_cache_sync.dart';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/fake_student_api.dart';

/// PR #542 review issue 6: a fetch cut off by `maxPages` must not prune
/// cached students the client never saw.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late AppDatabase db;
  late CacheCrypto crypto;

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    final Directory dir = await Directory.systemTemp.createTemp('trunc_');
    db = AppDatabase(overridePath: '${dir.path}/t.db');
    crypto = await CacheCrypto.fromSecureStorage(
      SecureStorage(const FlutterSecureStorage()),
    );
  });

  tearDown(() => db.close());

  Future<int> cachedCount() async =>
      Sqflite.firstIntValue(
        await (await db.database).rawQuery(
          'SELECT COUNT(*) FROM students_cache',
        ),
      ) ??
      -1;

  test('fetchAll reports completeness', () async {
    final FakeStudentApi api = FakeStudentApi(<Student>[
      for (int i = 0; i < 5; i++) fakeStudent(i),
    ]);
    final StudentCacheSync full = StudentCacheSync(
      cacheCrypto: crypto,
      pageSize: 2,
    );
    final ({List<Student> students, bool complete}) all = await full.fetchAll(
      api,
    );
    expect(all.students, hasLength(5));
    expect(all.complete, isTrue);

    final StudentCacheSync capped = StudentCacheSync(
      cacheCrypto: crypto,
      pageSize: 2,
      maxPages: 2,
    );
    final ({List<Student> students, bool complete}) part = await capped
        .fetchAll(api);
    expect(part.students, hasLength(4));
    expect(part.complete, isFalse);
  });

  test('truncated fetch upserts but does not prune', () async {
    final FakeStudentApi api = FakeStudentApi(<Student>[
      for (int i = 0; i < 5; i++) fakeStudent(i),
    ]);
    final StudentCacheSync sync = StudentCacheSync(
      cacheCrypto: crypto,
      pageSize: 2,
      maxPages: 1,
    );
    final Database raw = await db.database;
    await sync.replaceScope(
      raw,
      tenantId: 'tenant-a',
      remote: api.students,
    );
    expect(await cachedCount(), 5);

    final ({List<Student> students, bool complete}) part = await sync
        .fetchAll(api);
    final int pruned = await sync.replaceScope(
      raw,
      tenantId: 'tenant-a',
      remote: part.students,
      prune: part.complete,
    );
    expect(part.complete, isFalse);
    expect(pruned, 0);
    expect(await cachedCount(), 5);

    // A complete fetch still prunes removed students.
    api.students = <Student>[fakeStudent(0)];
    final ({List<Student> students, bool complete}) done = await sync
        .fetchAll(api);
    expect(done.complete, isTrue);
    await sync.replaceScope(
      raw,
      tenantId: 'tenant-a',
      remote: done.students,
      prune: done.complete,
    );
    expect(await cachedCount(), 1);
  });
}
