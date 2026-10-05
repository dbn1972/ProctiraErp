import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:proctira_mobile/core/di/injector.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/students/data/student_repository.dart';

import 'helpers/test_setup.dart';

/// PRC-M565: what this file proves, precisely.
///
/// 1. Cache *query scoping*: rows in `students_cache` are filtered by the
///    active `tenant_id` (a client-side WHERE). This is not, on its own,
///    evidence of cross-tenant safety.
/// 2. Gateway contract (stubbed adapter mirroring the gateway's tenant/JWT
///    match): requests carry the *active* tenant in `X-Tenant-ID`, a token
///    minted for another tenant is rejected, and a rejected response caches
///    nothing on the device.
///
/// Purge-on-switch and ciphertext/key binding are covered by
/// `test/tenant_switch_test.dart` and `test/cache_crypto_context_test.dart`.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('cache query is scoped to the active tenant_id on /students', (
    WidgetTester tester,
  ) async {
    final JourneyHarness harness = await bootstrapTestApp(
      tenantId: 'tenant-a',
      tenantDisplayName: 'Tenant A',
    );
    addTearDown(harness.dispose);

    await harness.markAuthenticated();

    // Seed one student under each tenant.
    // Seed through the real repository so rows are encrypted at rest
    // (plaintext payloads are refused by CacheCrypto, PRC-L008).
    final StudentRepository repo = getIt<StudentRepository>();
    Student student(String id, String first, String last, String inst) =>
        Student(
          id: id,
          firstName: first,
          lastName: last,
          nationalId: id,
          institutionId: inst,
          dateOfBirth: '2015-01-01',
          gender: 'F',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        );
    await tester.runAsync(() async {
      await repo.cacheStudent(student('stu-a-1', 'Ada', 'Lovelace', 'inst-a'));
      await harness.tenantProvider.setTenant(tenantId: 'tenant-b');
      await repo.cacheStudent(student('stu-b-1', 'Brent', 'Hopper', 'inst-b'));
      await harness.tenantProvider.setTenant(
        tenantId: 'tenant-a',
        displayName: 'Tenant A',
      );
    });
    await pumpJourneyApp(tester);
    goJourney('/students');
    await tester.pumpAndSettle();

    // Tenant A view: Ada is visible, Brent is not.
    expect(find.text('Ada Lovelace'), findsOneWidget);
    expect(find.text('Brent Hopper'), findsNothing);

    // Switch to tenant B via the provider. Re-pumping the screen forces
    // a fresh `searchStudents` query under the new tenant id.
    final TenantProvider tenant = harness.tenantProvider;
    await tenant.setTenant(tenantId: 'tenant-b', displayName: 'Tenant B');

    goJourney('/');
    await tester.pumpAndSettle();
    goJourney('/students');
    await tester.pumpAndSettle();

    // Tenant B view: Brent is visible, Ada is not.
    expect(find.text('Brent Hopper'), findsOneWidget);
    expect(find.text('Ada Lovelace'), findsNothing);
  });

  testWidgets(
    'gateway contract: token for another tenant is rejected and nothing is cached',
    (WidgetTester tester) async {
      final JourneyHarness harness = await bootstrapTestApp(
        tenantId: 'tenant-b',
        tenantDisplayName: 'Tenant B',
      );
      addTearDown(harness.dispose);
      // Token minted for tenant A while tenant B is active on the device.
      await harness.markAuthenticated(accessToken: 'jwt-for:tenant-a');
      final _GatewayTenantContractStub stub = _GatewayTenantContractStub();
      getIt<Dio>().httpClientAdapter = stub;

      // The rejection must surface to the caller instead of looking like an
      // empty roster (PRC-M043). Caught inside runAsync because the binding
      // reports (rather than rethrows) errors escaping the callback.
      ApiException? failure;
      List<CachedStudent>? results;
      await tester.runAsync(() async {
        try {
          results = await getIt<StudentRepository>().searchStudents();
        } on ApiException catch (error) {
          failure = error;
        }
      });

      expect(stub.requests, isNotEmpty);
      expect(stub.requests.first.headers['X-Tenant-ID'], 'tenant-b');
      expect(stub.rejected, 1);
      expect(results, isNull);
      expect(
        failure,
        isA<PermanentApiException>().having(
          (PermanentApiException e) => e.statusCode,
          'statusCode',
          403,
        ),
      );
      expect(await tableRowCount(harness.database, 'students_cache'), 0);
    },
  );

  testWidgets(
    'gateway contract: matching tenant token caches rows under that tenant only',
    (WidgetTester tester) async {
      final JourneyHarness harness = await bootstrapTestApp(
        tenantId: 'tenant-b',
        tenantDisplayName: 'Tenant B',
      );
      addTearDown(harness.dispose);
      await harness.markAuthenticated(accessToken: 'jwt-for:tenant-b');
      final _GatewayTenantContractStub stub = _GatewayTenantContractStub();
      getIt<Dio>().httpClientAdapter = stub;

      await tester.runAsync(() => getIt<StudentRepository>().searchStudents());

      expect(stub.rejected, 0);
      expect(
        await tableRowCount(
          harness.database,
          'students_cache',
          whereTenant: 'tenant-b',
        ),
        1,
      );
      expect(
        await tableRowCount(
          harness.database,
          'students_cache',
          whereTenant: 'tenant-a',
        ),
        0,
      );
    },
  );
}

/// Mirrors the gateway rule: the JWT tenant must equal `X-Tenant-ID`,
/// otherwise 403 TENANT_MISMATCH. Test tokens encode the tenant as
/// `jwt-for:<tenantId>`.
class _GatewayTenantContractStub implements HttpClientAdapter {
  final List<RequestOptions> requests = <RequestOptions>[];
  int rejected = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final String auth = '${options.headers['Authorization'] ?? ''}';
    final String tokenTenant = auth.replaceFirst('Bearer jwt-for:', '');
    final Object? headerTenant = options.headers['X-Tenant-ID'];
    final Map<String, List<String>> json = <String, List<String>>{
      Headers.contentTypeHeader: <String>['application/json'],
    };
    if (headerTenant != tokenTenant) {
      rejected += 1;
      return ResponseBody.fromString(
        jsonEncode(<String, dynamic>{
          'code': 'TENANT_MISMATCH',
          'message': 'Token tenant does not match request tenant',
          'statusCode': 403,
        }),
        403,
        headers: json,
      );
    }
    return ResponseBody.fromString(
      jsonEncode(<String, dynamic>{
        'data': <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'stu-remote-1',
            'firstName': 'Remote',
            'lastName': 'Child',
            'nationalId': 'R1',
            'institutionId': 'inst-b',
            'dateOfBirth': '2015-01-01',
            'gender': 'F',
            'createdAt': '2026-01-01T00:00:00.000Z',
            'updatedAt': '2026-01-01T00:00:00.000Z',
          },
        ],
        'pagination': <String, dynamic>{
          'page': 1,
          'pageSize': 50,
          'total': 1,
          'totalPages': 1,
        },
      }),
      200,
      headers: json,
    );
  }

  @override
  void close({bool force = false}) {}
}
