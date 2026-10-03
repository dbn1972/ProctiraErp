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

/// PRC-M043: only an unreachable server falls back to saved data.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late AppDatabase db;
  late TenantProvider tenant;
  late FakeReply reply;

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    final Directory dir = await Directory.systemTemp.createTemp('m043_');
    db = AppDatabase(overridePath: '${dir.path}/m043.db');
    tenant = TenantProvider(SecureStorage(const FlutterSecureStorage()));
    await tenant.setTenant(tenantId: 'tenant-a');
    // PRC-M567: the real v9 schema provides scholarship_programs_cache.
  });
  tearDown(() => db.close());

  ScholarshipRepository repo() => ScholarshipRepository(
    database: db,
    tenantProvider: tenant,
    dio: fakeDio((_) => reply),
  );

  test('403 propagates as error state (not cached/empty)', () async {
    reply = const FakeReply(403, <String, dynamic>{'message': 'Forbidden'});
    final ScholarshipBloc bloc = ScholarshipBloc(repository: repo());
    bloc.add(const ScholarshipProgramsRequested());
    final ScholarshipState s = await bloc.stream.firstWhere(
      (ScholarshipState s) =>
          s.status == ScholarshipStatus.error ||
          s.status == ScholarshipStatus.loaded,
    );
    expect(s.status, ScholarshipStatus.error);
    expect(s.errorMessage, isNot(contains('DioException')));
    await bloc.close();
  });

  test('connectionError returns cache with stale flag', () async {
    final ScholarshipRepository r = repo();
    reply = const FakeReply(200, <String, dynamic>{
      'data': <Map<String, dynamic>>[
        <String, dynamic>{'id': 'p1', 'name': 'Merit', 'status': 'open'},
      ],
    });
    await r.getPrograms();
    expect(r.lastServedFromCache, isFalse);
    // PRC-M567: the live fetch was written to the real local cache table.
    final List<Map<String, Object?>> cachedRows = await (await db.database)
        .query('scholarship_programs_cache');
    expect(cachedRows.single['id'], 'p1');
    expect(cachedRows.single['tenant_id'], 'tenant-a');

    reply = const FakeReply.fail(DioExceptionType.connectionError);
    final ScholarshipBloc bloc = ScholarshipBloc(repository: r);
    bloc.add(const ScholarshipProgramsRequested());
    final ScholarshipState s = await bloc.stream.firstWhere(
      (ScholarshipState s) =>
          s.status == ScholarshipStatus.error ||
          s.status == ScholarshipStatus.loaded,
    );
    expect(s.status, ScholarshipStatus.loaded);
    expect(s.fromCache, isTrue);
    expect(s.programs.single.id, 'p1');
    await bloc.close();
  });
}
