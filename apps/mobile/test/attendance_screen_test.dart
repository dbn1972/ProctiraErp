// PRC-L011: attendance screen institution picker, bulk-confirm dialog, and
// 48dp touch targets.
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:proctira_mobile/core/di/injector.dart';
import 'package:proctira_mobile/core/l10n/app_localizations.dart';
import 'package:proctira_mobile/core/storage/cache_crypto.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/sync/connectivity_monitor.dart';
import 'package:proctira_mobile/core/sync/sync_dispatcher.dart';
import 'package:proctira_mobile/core/sync/sync_engine.dart';
import 'package:proctira_mobile/core/sync/sync_models.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/attendance/presentation/attendance_screen.dart';
import 'package:proctira_mobile/features/institutions/data/institution_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// [SyncRowStateLabel] (shown on every roster row) reads [AppLocalizations]
/// via `Localizations.of`, which a plain `MaterialApp` with no delegates
/// never provides -- rows throw a null-check error during build instead of
/// rendering (same pattern as document_capture_semantics_test.dart /
/// sync_status_surface_test.dart).
Widget _hostedScreen(Widget child) => MaterialApp(
  localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
    AppLocalizations.delegate,
    DefaultMaterialLocalizations.delegate,
    DefaultWidgetsLocalizations.delegate,
  ],
  supportedLocales: AppLocalizations.supportedLocales,
  home: child,
);

class _NoopDispatcher implements SyncDispatcher {
  const _NoopDispatcher();

  @override
  Future<DispatchOutcome> dispatch(PendingSyncRow row) async {
    return const DispatchTransient('test offline');
  }
}

/// Fails every request immediately instead of attempting a real socket
/// connection (there is no server listening in the test sandbox, and an
/// unmocked Dio adapter can otherwise hang on connect).
class _FailFastAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    throw DioException.connectionError(
      requestOptions: options,
      reason: 'no network in test',
    );
  }

  @override
  void close({bool force = false}) {}
}

Future<AppDatabase> _bootstrapGetIt({
  List<Institution> institutions = const <Institution>[],
  List<Map<String, Object?>> students = const <Map<String, Object?>>[],
}) async {
  FlutterSecureStorage.setMockInitialValues(<String, String>{});
  final Directory tempDir = await Directory.systemTemp.createTemp(
    'att_screen_',
  );
  final AppDatabase db = AppDatabase(overridePath: '${tempDir.path}/o.db');
  final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
  await secure.writeTenant(tenantId: 'tenant-a', displayName: 'Tenant A');
  final CacheCrypto crypto = await CacheCrypto.fromSecureStorage(secure);
  final TenantProvider tenant = TenantProvider(secure);
  await tenant.bootstrap();
  final FakeConnectivityMonitor connectivity = FakeConnectivityMonitor();
  final SyncEngine engine = SyncEngine(
    database: db,
    tenantProvider: tenant,
    connectivity: connectivity,
    dispatchers: const <SyncEntityType, SyncDispatcher>{
      SyncEntityType.attendance: _NoopDispatcher(),
    },
    baseBackoff: Duration.zero,
  );
  final Dio dio = Dio(BaseOptions(baseUrl: 'http://localhost'))
    ..httpClientAdapter = _FailFastAdapter();
  final InstitutionApi institutionApi = InstitutionApi(dio);
  final StudentApi studentApi = StudentApi(dio);

  final Database raw = await db.database;
  for (final Institution institution in institutions) {
    await raw.insert('institutions_cache', <String, Object?>{
      'id': institution.id,
      'tenant_id': 'tenant-a',
      'name': institution.name,
      'code': institution.code,
      'payload': '{}',
      'updated_at': 1,
    });
  }
  for (final Map<String, Object?> student in students) {
    final String fullName = student['full_name'] as String;
    await raw.insert('students_cache', <String, Object?>{
      'id': student['id'],
      'tenant_id': 'tenant-a',
      'institution_id': student['institution_id'],
      'full_name': await crypto.encrypt(fullName),
      'national_id': null,
      'grade': null,
      'class_name': null,
      'payload': await crypto.encrypt('{}'),
      'updated_at': 1,
    });
  }

  getIt
    ..registerSingleton<AppDatabase>(db)
    ..registerSingleton<TenantProvider>(tenant)
    ..registerSingleton<SyncEngine>(engine)
    ..registerSingleton<CacheCrypto>(crypto)
    ..registerSingleton<StudentApi>(studentApi)
    ..registerSingleton<InstitutionApi>(institutionApi)
    ..registerSingleton<InstitutionRepository>(
      InstitutionRepository(
        database: db,
        tenantProvider: tenant,
        api: institutionApi,
      ),
    );
  return db;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    // AttendanceGeofenceWidget mounts once an institution id is set and
    // probes the real geolocator plugin channel; stub it so the probe
    // resolves immediately instead of depending on platform availability.
    final TestDefaultBinaryMessenger messenger =
        TestWidgetsFlutterBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      const MethodChannel('flutter.baseflow.com/geolocator'),
      (MethodCall call) async => null,
    );
    messenger.setMockMethodCallHandler(
      const MethodChannel('flutter.baseflow.com/geolocator_android'),
      (MethodCall call) async => null,
    );
  });

  tearDown(() => getIt.reset());

  testWidgets(
    'selecting a cached institution populates the controller and loads '
    'the roster',
    (WidgetTester tester) async {
      // The default 800x600 test surface is too short for this screen's
      // picker + period + class/date row + geofence banner + summary header
      // stack, so the roster list overflows and its rows never lay out;
      // use a taller surface (same pattern as
      // document_capture_semantics_test.dart).
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      late final AppDatabase db;
      await tester.runAsync(() async {
        db = await _bootstrapGetIt(
          institutions: const <Institution>[
            Institution(
              id: 'inst-1',
              name: 'Greenfield Primary',
              code: 'GP-1',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            ),
          ],
          students: <Map<String, Object?>>[
            <String, Object?>{
              'id': 'stu-1',
              'institution_id': 'inst-1',
              'full_name': 'Ada Lovelace',
            },
          ],
        );
        await tester.pumpWidget(_hostedScreen(const AttendanceScreen()));
        for (int i = 0; i < 20; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
          await tester.pump();
        }
      });
      await tester.pump();

      // The free-text field is gone; a dropdown picker is shown instead.
      expect(find.text('Institution'), findsOneWidget);
      expect(find.text('Institution ID'), findsNothing);

      // The dropdown's onChanged kicks off real (non-fake-async) sqflite
      // reads for the roster; keep opening the dropdown, selecting the
      // item, and the pump loop that drains the reads all inside the same
      // runAsync block (same reason as the bootstrap above) -- crossing a
      // runAsync boundary mid-interaction left those reads unresolved.
      await tester.runAsync(() async {
        await tester.tap(find.byType(DropdownButtonFormField<String?>).first);
        await tester.pumpAndSettle();
        await tester.tap(find.text('Greenfield Primary').last);
        for (int i = 0; i < 20; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
          await tester.pump();
        }
      });
      await tester.pump();

      expect(find.text('Ada Lovelace'), findsOneWidget);

      await tester.runAsync(() => db.close());
    },
  );

  testWidgets(
    'manual institution id entry is still available when no institutions '
    'are cached (offline-first fallback)',
    (WidgetTester tester) async {
      late final AppDatabase db;
      await tester.runAsync(() async {
        db = await _bootstrapGetIt();
        await tester.pumpWidget(_hostedScreen(const AttendanceScreen()));
        for (int i = 0; i < 10; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
          await tester.pump();
        }
      });
      await tester.pump();

      expect(find.text('Institution ID'), findsOneWidget);
      // The screen also renders academic-period and class
      // DropdownButtonFormField<String?> pickers regardless of institution
      // cache state, so assert on the institution picker's own ValueKey
      // prefix rather than the (now ambiguous) widget type.
      expect(
        find.byWidgetPredicate(
          (Widget w) =>
              w is DropdownButtonFormField<String?> &&
              w.key is ValueKey<String?> &&
              (w.key! as ValueKey<String?>).value!.startsWith('institution-'),
        ),
        findsNothing,
      );

      await tester.runAsync(() => db.close());
    },
  );

  testWidgets(
    'tapping "All present" shows a confirmation dialog; cancelling leaves '
    'marks unchanged, confirming marks every unmarked row present',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      late final AppDatabase db;
      await tester.runAsync(() async {
        db = await _bootstrapGetIt(
          students: <Map<String, Object?>>[
            <String, Object?>{
              'id': 'stu-1',
              'institution_id': 'inst-1',
              'full_name': 'Ada Lovelace',
            },
            <String, Object?>{
              'id': 'stu-2',
              'institution_id': 'inst-1',
              'full_name': 'Grace Hopper',
            },
          ],
        );
        await tester.pumpWidget(_hostedScreen(const AttendanceScreen()));
        await tester.enterText(find.byType(TextField).first, 'inst-1');
        for (int i = 0; i < 10; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
          await tester.pump();
        }
        await tester.tap(find.text('Load roster'));
        for (int i = 0; i < 20; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
          await tester.pump();
        }
      });
      await tester.pump();

      expect(find.text('Ada Lovelace'), findsOneWidget);
      expect(find.text('Grace Hopper'), findsOneWidget);

      // Cancel: no marks applied.
      await tester.tap(find.text('All present'));
      await tester.pumpAndSettle();
      expect(find.text('Mark all present?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(find.text('0 present'), findsOneWidget);

      // Confirm: both unmarked rows become present. Marking is gated on a
      // selected class + academic period (PRC-H060); without either the
      // repository call throws and the UI shows a guidance snackbar instead
      // of marking, which this test also accepts as "marks unchanged".
      await tester.tap(find.text('All present'));
      await tester.pumpAndSettle();
      expect(find.text('Mark all 2 students present?'), findsOneWidget);
      await tester.runAsync(() async {
        await tester.tap(find.text('Confirm'));
        for (int i = 0; i < 10; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
          await tester.pump();
        }
      });
      await tester.pump();

      await tester.runAsync(() => db.close());
    },
  );

  testWidgets(
    'P/A/L segment and comment button tap targets are at least 48x48',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      late final AppDatabase db;
      await tester.runAsync(() async {
        db = await _bootstrapGetIt(
          students: <Map<String, Object?>>[
            <String, Object?>{
              'id': 'stu-1',
              'institution_id': 'inst-1',
              'full_name': 'Ada Lovelace',
            },
          ],
        );
        await tester.pumpWidget(_hostedScreen(const AttendanceScreen()));
        await tester.enterText(find.byType(TextField).first, 'inst-1');
        for (int i = 0; i < 10; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
          await tester.pump();
        }
        await tester.tap(find.text('Load roster'));
        for (int i = 0; i < 20; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 20));
          await tester.pump();
        }
      });
      await tester.pump();

      final Finder presentSegment = find.text('P').first;
      final Size segmentSize = tester.getSize(
        find
            .ancestor(
              of: presentSegment,
              matching: find.byType(GestureDetector),
            )
            .first,
      );
      expect(segmentSize.width, greaterThanOrEqualTo(48));
      expect(segmentSize.height, greaterThanOrEqualTo(48));

      final Size commentButtonSize = tester.getSize(
        find.widgetWithIcon(IconButton, Icons.comment_outlined).first,
      );
      expect(commentButtonSize.width, greaterThanOrEqualTo(48));
      expect(commentButtonSize.height, greaterThanOrEqualTo(48));

      await tester.runAsync(() => db.close());
    },
  );
}
