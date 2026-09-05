import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/institutions/data/institution_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Adapter that fails every request — proves the cache path never falls
/// through to HTTP.
class _ExplodingHttpAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    throw StateError(
      'InstitutionApi must not be invoked when the cache has rows '
      '(intercepted ${options.method} ${options.path}).',
    );
  }

  @override
  void close({bool force = false}) {}
}

InstitutionApi _explodingApi() {
  final Dio dio = Dio(BaseOptions(baseUrl: 'http://localhost'));
  dio.httpClientAdapter = _ExplodingHttpAdapter();
  return InstitutionApi(dio);
}

/// Adapter that returns a static institution payload for cache-miss tests.
class _SeedingHttpAdapter implements HttpClientAdapter {
  _SeedingHttpAdapter(this.payload);
  final String payload;
  int calls = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls++;
    return ResponseBody.fromString(
      payload,
      200,
      headers: <String, List<String>>{
        'content-type': <String>['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

({InstitutionApi api, _SeedingHttpAdapter adapter}) _seedingApi(
  String payload,
) {
  final _SeedingHttpAdapter adapter = _SeedingHttpAdapter(payload);
  final Dio dio = Dio(BaseOptions(baseUrl: 'http://localhost'));
  dio.httpClientAdapter = adapter;
  return (api: InstitutionApi(dio), adapter: adapter);
}

Future<({AppDatabase db, TenantProvider tenant})> _bootstrap() async {
  final Directory tempDir = await Directory.systemTemp.createTemp('inst_repo_');
  final AppDatabase db =
      AppDatabase(overridePath: '${tempDir.path}/openemis.db');
  final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
  await secure.writeTenant(tenantId: 'tenant-a', displayName: 'Tenant A');
  final TenantProvider tenant = TenantProvider(secure);
  await tenant.bootstrap();
  return (db: db, tenant: tenant);
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

  test('findById returns cached row without invoking the api', () async {
    final ({AppDatabase db, TenantProvider tenant}) ctx = await _bootstrap();
    final Database raw = await ctx.db.database;
    await raw.insert('institutions_cache', <String, Object?>{
      'id': 'inst-1',
      'tenant_id': 'tenant-a',
      'name': 'Greenfield Primary',
      'code': 'GP-001',
      'area_id': 'area-1',
      'type': 'Primary',
      'sector': 'Public',
      'ownership': 'Government',
      'status': 'ACTIVE',
      'payload': '{"id":"inst-1","name":"Greenfield Primary"}',
      'updated_at': 1,
    });

    final InstitutionRepository repo = InstitutionRepository(
      database: ctx.db,
      tenantProvider: ctx.tenant,
      api: _explodingApi(),
    );

    final CachedInstitution? row = await repo.findById('inst-1');
    expect(row, isNotNull);
    expect(row!.name, 'Greenfield Primary');
    expect(row.code, 'GP-001');
    expect(row.tenantId, 'tenant-a');

    await ctx.db.close();
  });

  test('list returns rows ordered by name ascending', () async {
    final ({AppDatabase db, TenantProvider tenant}) ctx = await _bootstrap();
    final Database raw = await ctx.db.database;
    await raw.insert('institutions_cache', <String, Object?>{
      'id': 'inst-2',
      'tenant_id': 'tenant-a',
      'name': 'Beta Academy',
      'code': 'B',
      'payload': '{}',
      'updated_at': 1,
    });
    await raw.insert('institutions_cache', <String, Object?>{
      'id': 'inst-1',
      'tenant_id': 'tenant-a',
      'name': 'Alpha Academy',
      'code': 'A',
      'payload': '{}',
      'updated_at': 1,
    });

    final InstitutionRepository repo = InstitutionRepository(
      database: ctx.db,
      tenantProvider: ctx.tenant,
      api: _explodingApi(),
    );

    final List<CachedInstitution> rows = await repo.list();
    expect(rows.map((CachedInstitution i) => i.name).toList(),
        <String>['Alpha Academy', 'Beta Academy']);

    await ctx.db.close();
  });

  test(
      'findById falls back to the api on cache miss and seeds the cache',
      () async {
    final ({AppDatabase db, TenantProvider tenant}) ctx = await _bootstrap();
    const String payload = '''
{
  "data": {
    "id": "inst-1",
    "name": "Sunrise High",
    "code": "SH-1",
    "areaId": "area-1",
    "type": "Secondary",
    "sector": "Public",
    "ownership": "Government",
    "status": "ACTIVE",
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-02T00:00:00Z"
  }
}
''';
    final ({InstitutionApi api, _SeedingHttpAdapter adapter}) seed =
        _seedingApi(payload);

    final InstitutionRepository repo = InstitutionRepository(
      database: ctx.db,
      tenantProvider: ctx.tenant,
      api: seed.api,
    );

    final CachedInstitution? first = await repo.findById('inst-1');
    expect(first, isNotNull);
    expect(first!.name, 'Sunrise High');
    expect(seed.adapter.calls, 1);

    // Second call should be served from cache (no extra HTTP traffic).
    final CachedInstitution? second = await repo.findById('inst-1');
    expect(second, isNotNull);
    expect(seed.adapter.calls, 1);

    await ctx.db.close();
  });
}
