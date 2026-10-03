import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/storage/cache_crypto.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/scholarship/data/scholarship_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/fake_dio.dart';

/// PRC-H015: portal-only sessions (parent/guardian/student) call the
/// parent-portal scholarship routes; staff keep the staff routes. The v9
/// client migration makes the offline caches real, and cached application
/// payloads are sealed and bound to their row.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late Directory dir;
  late AppDatabase db;
  late TenantProvider tenant;
  late List<RequestOptions> seen;
  late FakeReply Function(RequestOptions) handler;
  final CacheCrypto crypto = CacheCrypto(
    Uint8List.fromList(List<int>.generate(32, (int i) => 31 - i)),
  );

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    dir = await Directory.systemTemp.createTemp('h015_');
    db = AppDatabase(overridePath: '${dir.path}/h015.db');
    tenant = TenantProvider(SecureStorage(const FlutterSecureStorage()));
    await tenant.setTenant(tenantId: 'tenant-a');
    seen = <RequestOptions>[];
    handler = (_) =>
        const FakeReply(200, <String, dynamic>{'data': <dynamic>[]});
  });

  tearDown(() async {
    await db.close();
    await dir.delete(recursive: true);
  });

  ScholarshipRepository repo({required bool portal}) => ScholarshipRepository(
    database: db,
    tenantProvider: tenant,
    cacheCrypto: crypto,
    isPortalSession: () => portal,
    dio: fakeDio((RequestOptions o) {
      seen.add(o);
      return handler(o);
    }),
  );

  test(
    'parent session lists programs and applications via parent-portal',
    () async {
      final ScholarshipRepository r = repo(portal: true);
      await r.getPrograms();
      await r.getApplications(studentId: 'child-1');
      expect(seen[0].path, '/api/v1/parent-portal/scholarships/programs');
      expect(seen[0].queryParameters, isEmpty);
      expect(seen[1].path, '/api/v1/parent-portal/scholarships/applications');
      expect(seen[1].queryParameters.containsKey('applicantId'), isFalse);
    },
  );

  test('staff session keeps the staff routes and applicant filter', () async {
    final ScholarshipRepository r = repo(portal: false);
    await r.getPrograms();
    await r.getApplications(studentId: 'child-1');
    expect(seen[0].path, '/api/v1/scholarships/programs');
    expect(seen[0].queryParameters['status'], 'open');
    expect(seen[1].path, '/api/v1/scholarships/applications');
    expect(seen[1].queryParameters['applicantId'], 'child-1');
  });

  test('parent draft edits and submit use parent-portal routes', () async {
    final ScholarshipRepository r = repo(portal: true);
    handler = (_) => const FakeReply(200, <String, dynamic>{'id': 'app-1'});
    await r.updateDraftApplication(
      applicationId: 'app-1',
      academicRecord: const ScholarshipAcademicRecord(
        institutionName: 'NHS',
        educationLevel: 'secondary',
      ),
    );
    await r.finalizeApplication('app-1');
    expect(seen[0].method, 'PUT');
    expect(
      seen[0].path,
      '/api/v1/parent-portal/scholarships/applications/app-1',
    );
    expect(
      seen[1].path,
      '/api/v1/parent-portal/scholarships/applications/app-1/submit',
    );
  });

  test('applications are cached sealed and served offline', () async {
    final ScholarshipRepository r = repo(portal: true);
    handler = (RequestOptions o) => o.path.endsWith('/applications')
        ? const FakeReply(200, <String, dynamic>{
            'data': <Map<String, dynamic>>[
              <String, dynamic>{
                'id': 'app-1',
                'programId': 'p1',
                'applicantId': 'child-1',
                'status': 'submitted',
              },
            ],
          })
        : const FakeReply(200, <String, dynamic>{'data': <dynamic>[]});
    final List<ScholarshipApplication> live = await r.getApplications(
      studentId: 'child-1',
    );
    expect(live.single.id, 'app-1');

    final Database raw = await db.database;
    final List<Map<String, Object?>> rows = await raw.query(
      'scholarship_applications_cache',
    );
    expect(
      rows.single['payload'] as String,
      startsWith(CacheCrypto.contextCipherPrefix),
    );
    expect(rows.single['payload'] as String, isNot(contains('child-1')));

    handler = (_) => const FakeReply.fail(DioExceptionType.connectionError);
    final List<ScholarshipApplication> cached = await r.getApplications(
      studentId: 'child-1',
    );
    expect(r.lastServedFromCache, isTrue);
    expect(cached.single.id, 'app-1');

    // A plaintext row (pre-v9 build or tampering) is never surfaced.
    await raw.update('scholarship_applications_cache', <String, Object?>{
      'payload': '{"id":"app-1","applicantId":"child-1"}',
    });
    expect(await r.getApplications(studentId: 'child-1'), isEmpty);
  });
}
