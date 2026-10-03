import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/scholarship/bloc/scholarship_bloc.dart';
import 'package:proctira_mobile/features/scholarship/data/scholarship_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/fake_dio.dart';

const String _program = '11111111-1111-4111-8111-111111111111';
const String _student = '22222222-2222-4222-8222-222222222222';
const String _school = '33333333-3333-4333-8333-333333333333';
const ScholarshipAcademicRecord _record = ScholarshipAcademicRecord(
  institutionName: 'Govt. High School, Ward 4',
  educationLevel: 'secondary',
);

/// PRC-M044: later edits reach the draft before finalize; no placeholders.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late AppDatabase db;
  late ScholarshipRepository repo;
  final List<RequestOptions> requests = <RequestOptions>[];

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    final Directory dir = await Directory.systemTemp.createTemp('m044_');
    db = AppDatabase(overridePath: '${dir.path}/m044.db');
    final TenantProvider tenant = TenantProvider(
      SecureStorage(const FlutterSecureStorage()),
    );
    await tenant.setTenant(tenantId: 'tenant-a');
    requests.clear();
    repo = ScholarshipRepository(
      database: db,
      tenantProvider: tenant,
      dio: fakeDio((RequestOptions o) {
        requests.add(o);
        if (o.method == 'GET' && o.path.endsWith('/programs')) {
          return const FakeReply(200, <String, dynamic>{
            'data': <Map<String, dynamic>>[
              <String, dynamic>{
                'id': _program,
                'name': 'Merit',
                'status': 'open',
              },
            ],
          });
        }
        if (o.method == 'POST' && o.path.endsWith('/applications')) {
          return const FakeReply(201, <String, dynamic>{
            'data': <String, dynamic>{'id': 'app-1'},
          });
        }
        return const FakeReply(200, <String, dynamic>{});
      }),
    );
  });
  tearDown(() => db.close());

  test('draft carries the real academic record, not a placeholder', () async {
    await repo.createDraftApplication(
      programId: _program,
      studentId: _student,
      institutionId: _school,
      academicRecord: _record,
      personalStatement: 'first',
    );
    final Map<String, dynamic> body =
        requests.single.data as Map<String, dynamic>;
    expect(body.toString(), isNot(contains('Current school')));
    expect((body['academicRecords'] as List).single, _record.toJson());
  });

  test(
    'edit statement after upload, submit -> PUT latest then submit',
    () async {
      final String id = await repo.createDraftApplication(
        programId: _program,
        studentId: _student,
        institutionId: _school,
        academicRecord: _record,
        personalStatement: 'first draft text',
      );
      requests.clear();
      final ScholarshipBloc bloc = ScholarshipBloc(repository: repo);
      bloc.add(
        ScholarshipApplicationSubmitted(
          programId: _program,
          studentId: _student,
          draftApplicationId: id,
          academicRecord: _record,
          additionalData: const <String, dynamic>{
            'personalStatement': 'edited final statement',
            'familyIncome': 120000.0,
          },
        ),
      );
      await bloc.stream.firstWhere(
        (ScholarshipState s) =>
            s.status == ScholarshipStatus.submitted ||
            s.status == ScholarshipStatus.error,
      );
      final List<RequestOptions> writes = requests
          .where((RequestOptions o) => o.method != 'GET')
          .toList();
      expect(
        writes.map((RequestOptions o) => '${o.method} ${o.path}'),
        <String>[
          'PUT /api/v1/scholarships/applications/app-1',
          'POST /api/v1/scholarships/applications/app-1/submit',
        ],
      );
      final Map<String, dynamic> put =
          writes.first.data as Map<String, dynamic>;
      expect(put['personalStatement'], 'edited final statement');
      expect(put['financialInfo'], <String, dynamic>{'familyIncome': 120000.0});
      await bloc.close();
    },
  );
}
