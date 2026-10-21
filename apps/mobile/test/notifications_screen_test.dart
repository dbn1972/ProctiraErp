import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:proctira_mobile/core/di/injector.dart';
import 'package:proctira_mobile/core/notifications/notification_router.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/sync/connectivity_monitor.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/notifications/data/notification_repository.dart';
import 'package:proctira_mobile/features/notifications/presentation/notifications_screen.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Adapter that fails every request, so [NotificationDeviceApi.markAsRead]
/// exercises its real swallow-the-error path against a genuine 5xx instead
/// of a mock.
class _FailingAdapter implements HttpClientAdapter {
  int calls = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls++;
    return ResponseBody.fromString('{"message":"boom"}', 500);
  }

  @override
  void close({bool force = false}) {}
}

/// PRC-L014: tapping a notification still navigates even when the server
/// read-sync call fails.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  tearDown(() => getIt.reset());

  testWidgets(
    'tapping a notification marks it read locally and still navigates '
    'when the device api 500s',
    (WidgetTester tester) async {
      AppDatabase? db;
      NotificationRepository? repository;
      _FailingAdapter? adapter;

      // sqflite-ffi and secure-storage bootstrap do real (non-fake-async)
      // file I/O, which never resolves under `testWidgets`' fake clock
      // without `runAsync` (mirrors enrollment_history_refresh_test.dart).
      await tester.runAsync(() async {
        final Directory tempDir = await Directory.systemTemp.createTemp(
          'notif_screen_',
        );
        final AppDatabase localDb = AppDatabase(
          overridePath: '${tempDir.path}/openemis.db',
        );
        db = localDb;
        final SecureStorage secure = SecureStorage(
          const FlutterSecureStorage(),
        );
        await secure.writeTenant(tenantId: 'tenant-a', displayName: 'Tenant A');
        final TenantProvider tenant = TenantProvider(secure);
        await tenant.bootstrap();

        final NotificationRepository repo = NotificationRepository(
          database: localDb,
          tenantProvider: tenant,
        );
        repository = repo;
        // REPORT_READY (with an entityId) routes to a distinct `/reports/:id`
        // path rather than back to `/notifications` itself, so the test can
        // assert navigation happened without a same-route push recursing.
        await repo.insert(
          id: 'notif-1',
          tenantId: 'tenant-a',
          type: 'REPORT_READY',
          title: 'Approval needed',
          body: 'Body',
          payload: const <String, dynamic>{
            'type': 'REPORT_READY',
            'entityId': 'rep-1',
          },
        );

        final _FailingAdapter localAdapter = _FailingAdapter();
        adapter = localAdapter;
        final Dio dio = Dio(BaseOptions(baseUrl: 'https://api.test'))
          ..httpClientAdapter = localAdapter;
        final NotificationDeviceApi deviceApi = NotificationDeviceApi(dio);

        getIt
          ..registerSingleton<ConnectivityMonitor>(
            FakeConnectivityMonitor(startsOnline: false),
          )
          ..registerSingleton<NotificationRouter>(const NotificationRouter())
          ..registerSingleton<NotificationRepository>(repo)
          ..registerSingleton<NotificationDeviceApi>(deviceApi);
      });

      // The screen's own async work (NotificationRepository.listAll(), which
      // does real sqflite-ffi file I/O) also needs runAsync, same reason as
      // the bootstrap above.
      await tester.runAsync(() async {
        await tester.pumpWidget(
          MaterialApp.router(
            routerConfig: GoRouter(
              initialLocation: '/notifications',
              routes: <RouteBase>[
                GoRoute(
                  path: '/notifications',
                  builder: (_, _) => const NotificationsScreen(),
                ),
                GoRoute(
                  path: '/notifications/preferences',
                  builder: (_, _) => const SizedBox.shrink(),
                ),
                GoRoute(
                  path: '/reports/:id',
                  builder: (_, GoRouterState state) => Scaffold(
                    body: Text('Report ${state.pathParameters['id']}'),
                  ),
                ),
              ],
            ),
          ),
        );
        for (int i = 0; i < 50; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
          await tester.pump();
          if (find.text('Approval needed').evaluate().isNotEmpty) break;
        }
      });
      await tester.pump();

      expect(find.text('Approval needed'), findsOneWidget);
      await tester.runAsync(() async {
        await tester.tap(find.text('Approval needed'));
        for (int i = 0; i < 50; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
          await tester.pump();
          if (find.text('Report rep-1').evaluate().isNotEmpty &&
              adapter!.calls > 0) {
            break;
          }
        }
      });
      await tester.pump();

      // The tap navigated to the report screen regardless of whether the
      // fire-and-forget device-api call has resolved yet — the failure
      // never blocked navigation.
      expect(find.text('Report rep-1'), findsOneWidget);
      // The device api was actually invoked and actually failed.
      expect(adapter!.calls, 1);

      await tester.runAsync(() async {
        final List<CachedNotification> after = await repository!.listAll();
        expect(after.single.read, isTrue);
        await db!.close();
      });
    },
  );
}
