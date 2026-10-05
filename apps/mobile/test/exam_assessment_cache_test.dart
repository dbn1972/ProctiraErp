import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/storage/cache_crypto.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/assessment/bloc/assessment_bloc.dart';
import 'package:proctira_mobile/features/assessment/data/assessment_repository.dart';
import 'package:proctira_mobile/features/examination/data/examination_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/fake_dio.dart';

class _Ctx {
  _Ctx(this.db, this.tenant, this.crypto);
  final AppDatabase db;
  final TenantProvider tenant;
  final CacheCrypto crypto;
}

Future<_Ctx> _bootstrap() async {
  final Directory dir = await Directory.systemTemp.createTemp('exam_cache_');
  final AppDatabase db = AppDatabase(overridePath: '${dir.path}/e.db');
  final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
  await secure.writeTenant(tenantId: 'tenant-a', displayName: 'Tenant A');
  final TenantProvider tenant = TenantProvider(secure);
  await tenant.bootstrap();
  return _Ctx(db, tenant, await CacheCrypto.fromSecureStorage(secure));
}

const Map<String, dynamic> _exam = <String, dynamic>{
  'id': 'ex-1',
  'name': 'Term Final',
  'subjectName': 'Mathematics',
  'examDate': '2026-03-01',
  'startTime': '09:00',
  'endTime': '11:00',
  'status': 'upcoming',
};

const Map<String, dynamic> _examResult = <String, dynamic>{
  'id': 'er-1',
  'examinationId': 'ex-1',
  'examinationName': 'Term Final',
  'subjectName': 'Mathematics',
  'score': 41,
  'remarks': 'Needs support with fractions',
};

const Map<String, dynamic> _assessment = <String, dynamic>{
  'id': 'as-1',
  'studentId': 'stu-1',
  'subjectName': 'Science',
  'periodName': 'Term 1',
  'score': 7,
  'grade': 'C',
  'remarks': 'Private teacher note',
};

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
    'PRC-M035: exam schedule/results payloads are ciphertext at rest',
    () async {
      final _Ctx ctx = await _bootstrap();
      final ExaminationRepository repo = ExaminationRepository(
        database: ctx.db,
        tenantProvider: ctx.tenant,
        cacheCrypto: ctx.crypto,
        dio: fakeDio((RequestOptions o) {
          if (o.path.endsWith('/results')) {
            return const FakeReply(200, <String, dynamic>{
              'data': <Object>[_examResult],
            });
          }
          return const FakeReply(200, <String, dynamic>{
            'data': <Object>[_exam],
          });
        }),
      );
      await repo.getExaminations(studentId: 'stu-1');
      await repo.getResults(studentId: 'stu-1');

      final Database raw = await ctx.db.database;
      for (final String table in <String>[
        'examinations_cache',
        'examination_results_cache',
      ]) {
        final List<Map<String, Object?>> rows = await raw.query(table);
        expect(rows, hasLength(1), reason: table);
        final String payload = rows.single['payload']! as String;
        expect(payload, startsWith('enc:'), reason: table);
        expect(payload, isNot(contains('Mathematics')), reason: table);
        expect(payload, isNot(contains('fractions')), reason: table);
      }
    },
  );

  test('PRC-M035: exam cache is readable offline after sealing', () async {
    final _Ctx ctx = await _bootstrap();
    bool online = true;
    final ExaminationRepository repo = ExaminationRepository(
      database: ctx.db,
      tenantProvider: ctx.tenant,
      cacheCrypto: ctx.crypto,
      dio: fakeDio(
        (RequestOptions o) => online
            ? const FakeReply(200, <String, dynamic>{
                'data': <Object>[_examResult],
              })
            : const FakeReply.fail(DioExceptionType.connectionError),
      ),
    );
    await repo.getResults(studentId: 'stu-1');
    online = false;
    final List<ExaminationResult> cached = await repo.getResults(
      studentId: 'stu-1',
    );
    expect(cached.single.remarks, 'Needs support with fractions');
  });

  test(
    'PRC-M035: logout purge empties examination and assessment caches',
    () async {
      final _Ctx ctx = await _bootstrap();
      final ExaminationRepository exams = ExaminationRepository(
        database: ctx.db,
        tenantProvider: ctx.tenant,
        cacheCrypto: ctx.crypto,
        dio: fakeDio(
          (RequestOptions o) => o.path.endsWith('/results')
              ? const FakeReply(200, <String, dynamic>{
                  'data': <Object>[_examResult],
                })
              : const FakeReply(200, <String, dynamic>{
                  'data': <Object>[_exam],
                }),
        ),
      );
      await exams.getExaminations(studentId: 'stu-1');
      await exams.getResults(studentId: 'stu-1');
      await ctx.db.purgeAllUserData();
      final Database raw = await ctx.db.database;
      for (final String table in <String>[
        'examinations_cache',
        'examination_results_cache',
        'assessment_results_cache',
      ]) {
        expect(await raw.query(table), isEmpty, reason: table);
      }
    },
  );

  group('PRC-M562 assessment fallback', () {
    late _Ctx ctx;
    late FakeReply reply;
    late AssessmentRepository repo;

    setUp(() async {
      ctx = await _bootstrap();
      reply = const FakeReply(200, <String, dynamic>{
        'data': <Object>[_assessment],
      });
      repo = AssessmentRepository(
        database: ctx.db,
        tenantProvider: ctx.tenant,
        cacheCrypto: ctx.crypto,
        dio: fakeDio((RequestOptions o) => reply),
      );
      // Seed the cache with one live fetch.
      await repo.getResults(studentId: 'stu-1');
    });

    test('scores are not stored in plaintext columns', () async {
      final Database raw = await ctx.db.database;
      final Map<String, Object?> row = (await raw.query(
        'assessment_results_cache',
      )).single;
      expect(row['score'], isNull);
      expect(row['grade'], isNull);
      expect(row['remarks'], isNull);
      expect(row['payload']! as String, isNot(contains('Private')));
    });

    test('403 surfaces as an error state, not stale data', () async {
      reply = const FakeReply(403, <String, dynamic>{'message': 'Forbidden'});
      final AssessmentBloc bloc = AssessmentBloc(repository: repo);
      bloc.add(const AssessmentResultsRequested(studentId: 'stu-1'));
      final AssessmentState state = await bloc.stream.firstWhere(
        (AssessmentState s) =>
            s.status == AssessmentStatus.error ||
            s.status == AssessmentStatus.loaded,
      );
      expect(state.status, AssessmentStatus.error);
      expect(state.errorMessage, isNot(contains('DioException')));
      await bloc.close();
    });

    test('timeout serves cached results flagged as offline', () async {
      reply = const FakeReply.fail(DioExceptionType.receiveTimeout);
      final AssessmentBloc bloc = AssessmentBloc(repository: repo);
      bloc.add(const AssessmentResultsRequested(studentId: 'stu-1'));
      final AssessmentState state = await bloc.stream.firstWhere(
        (AssessmentState s) =>
            s.status == AssessmentStatus.error ||
            s.status == AssessmentStatus.loaded,
      );
      expect(state.status, AssessmentStatus.loaded);
      expect(state.fromCache, isTrue);
      expect(state.results.single.remarks, 'Private teacher note');
      await bloc.close();
    });
  });

  test('PR #542: exam 403 surfaces instead of serving cached data', () async {
    final _Ctx ctx = await _bootstrap();
    FakeReply? forced;
    final ExaminationRepository repo = ExaminationRepository(
      database: ctx.db,
      tenantProvider: ctx.tenant,
      cacheCrypto: ctx.crypto,
      dio: fakeDio(
        (RequestOptions o) =>
            forced ??
            (o.path.endsWith('/results')
                ? const FakeReply(200, <String, dynamic>{
                    'data': <Object>[_examResult],
                  })
                : const FakeReply(200, <String, dynamic>{
                    'data': <Object>[_exam],
                  })),
      ),
    );
    // Seed both caches with a live fetch.
    await repo.getExaminations(studentId: 'stu-1');
    await repo.getResults(studentId: 'stu-1');

    forced = const FakeReply(403, <String, dynamic>{'message': 'Forbidden'});
    await expectLater(
      repo.getExaminations(studentId: 'stu-1'),
      throwsA(isA<DioException>()),
    );
    await expectLater(
      repo.getResults(studentId: 'stu-1'),
      throwsA(isA<DioException>()),
    );

    forced = const FakeReply.fail(DioExceptionType.connectionError);
    expect(await repo.getExaminations(studentId: 'stu-1'), hasLength(1));
    expect(await repo.getResults(studentId: 'stu-1'), hasLength(1));
  });
}
