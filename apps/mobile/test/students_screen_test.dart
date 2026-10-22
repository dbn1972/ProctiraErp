// PRC-M567: widget-level coverage for StudentsScreen (the screen itself, as
// opposed to its repository which is covered by students_repository_test.dart).
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:proctira_mobile/core/di/injector.dart';
import 'package:proctira_mobile/core/storage/cache_crypto.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/sync/connectivity_monitor.dart';
import 'package:proctira_mobile/core/sync/sync_dispatcher.dart';
import 'package:proctira_mobile/core/sync/sync_engine.dart';
import 'package:proctira_mobile/core/sync/sync_models.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/students/presentation/students_screen.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class _NoopDispatcher implements SyncDispatcher {
  const _NoopDispatcher();

  @override
  Future<DispatchOutcome> dispatch(PendingSyncRow row) async {
    return const DispatchTransient('test offline');
  }
}

/// Fails every request so the screen never falls through to the network
/// when the cache already has rows.
class _ExplodingHttpAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    throw StateError(
      'Unexpected network call: ${options.method} ${options.path}',
    );
  }

  @override
  void close({bool force = false}) {}
}

Future<AppDatabase> _bootstrapGetIt() async {
  FlutterSecureStorage.setMockInitialValues(<String, String>{});
  final Directory tempDir = await Directory.systemTemp.createTemp(
    'students_screen_',
  );
  final AppDatabase db = AppDatabase(overridePath: '${tempDir.path}/o.db');
  final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
  await secure.writeTenant(tenantId: 'tenant-a', displayName: 'Tenant A');
  final CacheCrypto crypto = await CacheCrypto.fromSecureStorage(secure);
  final TenantProvider tenant = TenantProvider(secure);
  await tenant.bootstrap();
  final SyncEngine engine = SyncEngine(
    database: db,
    tenantProvider: tenant,
    connectivity: FakeConnectivityMonitor(),
    dispatchers: const <SyncEntityType, SyncDispatcher>{
      SyncEntityType.student: _NoopDispatcher(),
    },
    baseBackoff: Duration.zero,
  );
  final Dio dio = Dio(BaseOptions(baseUrl: 'http://localhost'))
    ..httpClientAdapter = _ExplodingHttpAdapter();

  getIt
    ..registerSingleton<AppDatabase>(db)
    ..registerSingleton<TenantProvider>(tenant)
    ..registerSingleton<SyncEngine>(engine)
    ..registerSingleton<CacheCrypto>(crypto)
    ..registerSingleton<StudentApi>(StudentApi(dio));

  final Database raw = await db.database;
  await raw.insert('students_cache', <String, Object?>{
    'id': 'stu-1',
    'tenant_id': 'tenant-a',
    'institution_id': 'inst-1',
    'full_name': await crypto.encrypt('Ada Lovelace'),
    'national_id': await crypto.encrypt('A1'),
    'grade': null,
    'class_name': null,
    'payload': await crypto.encrypt(
      '{"id":"stu-1","firstName":"Ada","lastName":"Lovelace","nationalId":"A1","institutionId":"inst-1","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}',
    ),
    'updated_at': 1,
  });
  await raw.insert('students_cache', <String, Object?>{
    'id': 'stu-2',
    'tenant_id': 'tenant-a',
    'institution_id': 'inst-1',
    'full_name': await crypto.encrypt('Grace Hopper'),
    'national_id': await crypto.encrypt('A2'),
    'grade': null,
    'class_name': null,
    'payload': await crypto.encrypt(
      '{"id":"stu-2","firstName":"Grace","lastName":"Hopper","nationalId":"A2","institutionId":"inst-1","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}',
    ),
    'updated_at': 1,
  });

  return db;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  tearDown(() => getIt.reset());

  testWidgets('cached students render on load', (WidgetTester tester) async {
    late final AppDatabase db;

    await tester.runAsync(() async {
      db = await _bootstrapGetIt();
      await tester.pumpWidget(
        MaterialApp.router(
          routerConfig: GoRouter(
            initialLocation: '/students',
            routes: <RouteBase>[
              GoRoute(
                path: '/students',
                builder: (_, _) => const StudentsScreen(),
              ),
              GoRoute(
                path: '/students/:id',
                builder: (_, GoRouterState state) => Scaffold(
                  body: Text('Profile ${state.pathParameters['id']}'),
                ),
              ),
            ],
          ),
        ),
      );
      for (int i = 0; i < 20; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
        await tester.pump();
      }
    });
    await tester.pump();

    expect(find.text('Ada Lovelace'), findsOneWidget);
    expect(find.text('Grace Hopper'), findsOneWidget);

    // sqflite's close() does real (non-fake-async) file I/O; it never
    // resolves under testWidgets' fake clock without runAsync (same reason
    // as the bootstrap above).
    await tester.runAsync(() => db.close());
  });

  testWidgets('the search field filters the cached list', (
    WidgetTester tester,
  ) async {
    late final AppDatabase db;

    await tester.runAsync(() async {
      db = await _bootstrapGetIt();
      await tester.pumpWidget(const MaterialApp(home: StudentsScreen()));
      for (int i = 0; i < 20; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
        await tester.pump();
      }
    });
    await tester.pump();

    expect(find.text('Ada Lovelace'), findsOneWidget);
    expect(find.text('Grace Hopper'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'grace');
    await tester.runAsync(() async {
      await tester.testTextInput.receiveAction(TextInputAction.search);
      for (int i = 0; i < 20; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
        await tester.pump();
      }
    });
    await tester.pump();

    expect(find.text('Grace Hopper'), findsOneWidget);
    expect(find.text('Ada Lovelace'), findsNothing);

    await tester.runAsync(() => db.close());
  });

  testWidgets('tapping a row navigates to the student profile route', (
    WidgetTester tester,
  ) async {
    late final AppDatabase db;

    await tester.runAsync(() async {
      db = await _bootstrapGetIt();
      await tester.pumpWidget(
        MaterialApp.router(
          routerConfig: GoRouter(
            initialLocation: '/students',
            routes: <RouteBase>[
              GoRoute(
                path: '/students',
                builder: (_, _) => const StudentsScreen(),
              ),
              GoRoute(
                path: '/students/:id',
                builder: (_, GoRouterState state) => Scaffold(
                  body: Text('Profile ${state.pathParameters['id']}'),
                ),
              ),
            ],
          ),
        ),
      );
      for (int i = 0; i < 20; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
        await tester.pump();
      }
    });
    await tester.pump();

    await tester.tap(find.text('Ada Lovelace'));
    await tester.pumpAndSettle();

    expect(find.text('Profile stu-1'), findsOneWidget);

    await tester.runAsync(() => db.close());
  });
}
