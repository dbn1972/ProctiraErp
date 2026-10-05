import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:proctira_mobile/core/di/injector.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/sync/connectivity_monitor.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/institutions/data/institution_repository.dart';
import 'package:proctira_mobile/features/institutions/presentation/institutions_screen.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

Institution _inst(String id) => Institution(
  id: id,
  name: 'School $id',
  code: 'C-$id',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
);

class _FakeApi implements InstitutionApi {
  _FakeApi(this.items);
  List<Institution> items;
  bool fail = false;
  final List<String> calls = <String>[];

  @override
  Future<List<Institution>> listInstitutions({
    int page = 1,
    int pageSize = 100,
  }) async {
    calls.add('list:$page');
    if (fail) {
      throw DioException(
        requestOptions: RequestOptions(path: '/api/v1/institutions'),
        response: Response<dynamic>(
          requestOptions: RequestOptions(path: '/api/v1/institutions'),
          statusCode: 500,
        ),
        type: DioExceptionType.badResponse,
      );
    }
    final int start = (page - 1) * pageSize;
    if (start >= items.length) return const <Institution>[];
    final int end = (start + pageSize).clamp(0, items.length);
    return items.sublist(start, end);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// PRC-M037: institutions list refresh uses the list endpoint, not the
/// tenant id as an institution id.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late AppDatabase db;
  late TenantProvider tenant;

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    final Directory dir = await Directory.systemTemp.createTemp('m037_');
    db = AppDatabase(overridePath: '${dir.path}/m037.db');
    tenant = TenantProvider(SecureStorage(const FlutterSecureStorage()));
    await tenant.setTenant(tenantId: 'tenant-a');
  });
  tearDown(() async {
    await getIt.reset();
    await db.close();
  });

  test('refreshAll pages, caches all and drops removed rows', () async {
    final _FakeApi api = _FakeApi(
      List<Institution>.generate(5, (int i) => _inst('$i')),
    );
    final InstitutionRepository repo = InstitutionRepository(
      database: db,
      tenantProvider: tenant,
      api: api,
    );
    expect(await repo.refreshAll(pageSize: 2), 5);
    expect(api.calls, <String>['list:1', 'list:2', 'list:3']);
    expect((await repo.list()).length, 5);

    api.items = <Institution>[_inst('0')];
    await repo.refreshAll(pageSize: 2);
    expect((await repo.list()).map((CachedInstitution c) => c.id), <String>[
      '0',
    ]);
  });

  test('refreshAll propagates API failure', () async {
    final _FakeApi api = _FakeApi(const <Institution>[])..fail = true;
    final InstitutionRepository repo = InstitutionRepository(
      database: db,
      tenantProvider: tenant,
      api: api,
    );
    expect(repo.refreshAll(), throwsA(isA<DioException>()));
  });

  test('refreshAll capped by maxPages upserts without dropping rows', () async {
    final _FakeApi api = _FakeApi(<Institution>[
      for (int i = 0; i < 5; i++) _inst('$i'),
    ]);
    final InstitutionRepository repo = InstitutionRepository(
      database: db,
      tenantProvider: tenant,
      api: api,
    );
    expect(await repo.refreshAll(pageSize: 2), 5);

    // Server order changed; the capped fetch only sees the first page.
    api.items = <Institution>[_inst('4'), _inst('3'), _inst('2')];
    expect(await repo.refreshAll(pageSize: 2, maxPages: 1), 2);
    expect((await repo.list()).length, 5);
  });

  Future<void> pumpScreen(WidgetTester tester, _FakeApi api) async {
    getIt.registerSingleton<InstitutionRepository>(
      InstitutionRepository(database: db, tenantProvider: tenant, api: api),
    );
    getIt.registerSingleton<ConnectivityMonitor>(
      FakeConnectivityMonitor(startsOnline: true),
    );
    getIt.registerSingleton<TenantProvider>(tenant);
    await tester.runAsync(() async {
      await tester.pumpWidget(const MaterialApp(home: InstitutionsScreen()));
      for (int i = 0; i < 20; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
        await tester.pump();
      }
    });
    await tester.pump();
  }

  testWidgets('mocked API with 3 institutions shows 3 rows', (
    WidgetTester tester,
  ) async {
    await pumpScreen(
      tester,
      _FakeApi(<Institution>[_inst('1'), _inst('2'), _inst('3')]),
    );
    expect(find.text('School 1'), findsOneWidget);
    expect(find.text('School 2'), findsOneWidget);
    expect(find.text('School 3'), findsOneWidget);
  });

  testWidgets('API failure shows error with retry, not empty state', (
    WidgetTester tester,
  ) async {
    await pumpScreen(tester, _FakeApi(const <Institution>[])..fail = true);
    expect(find.text('No institutions cached.'), findsNothing);
    expect(find.text('Retry'), findsOneWidget);
    expect(find.textContaining('DioException'), findsNothing);
  });
}
