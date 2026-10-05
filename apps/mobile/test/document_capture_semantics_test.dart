import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:proctira_mobile/core/di/injector.dart';
import 'package:proctira_mobile/core/l10n/app_localizations.dart';
import 'package:proctira_mobile/core/storage/cache_crypto.dart';
import 'package:proctira_mobile/core/storage/captured_document_store.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/sync/connectivity_monitor.dart';
import 'package:proctira_mobile/core/sync/sync_dispatcher.dart';
import 'package:proctira_mobile/core/sync/sync_engine.dart';
import 'package:proctira_mobile/core/sync/sync_models.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/students/presentation/document_capture_screen.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class _NoApi implements StudentApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// PRC-M048: capture controls are named, focusable buttons.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });
  tearDown(() => getIt.reset());

  testWidgets('shutter and gallery expose accessible button names', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle semantics = tester.ensureSemantics();
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.runAsync(() async {
      FlutterSecureStorage.setMockInitialValues(<String, String>{});
      final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
      final CacheCrypto crypto = await CacheCrypto.fromSecureStorage(secure);
      final Directory dir = await Directory.systemTemp.createTemp('m048_');
      final AppDatabase db = AppDatabase(overridePath: '${dir.path}/m048.db');
      final TenantProvider tenant = TenantProvider(secure);
      getIt
        ..registerSingleton<AppDatabase>(db)
        ..registerSingleton<TenantProvider>(tenant)
        ..registerSingleton<CacheCrypto>(crypto)
        ..registerSingleton<StudentApi>(_NoApi())
        ..registerSingleton<CapturedDocumentStore>(
          CapturedDocumentStore(crypto: crypto, dir: () async => dir),
        )
        ..registerSingleton<SyncEngine>(
          SyncEngine(
            database: db,
            tenantProvider: tenant,
            connectivity: FakeConnectivityMonitor(),
            dispatchers: const <SyncEntityType, SyncDispatcher>{},
          ),
        );
    });
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
          AppLocalizations.delegate,
          DefaultMaterialLocalizations.delegate,
          DefaultWidgetsLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: const DocumentCaptureScreen(studentId: 'stu-1'),
      ),
    );
    await tester.pump();

    final SemanticsNode shutter = tester.getSemantics(
      find.bySemanticsLabel('Take photo'),
    );
    expect(
      shutter,
      isSemantics(
        label: 'Take photo',
        isButton: true,
        isEnabled: true,
        hasTapAction: true,
      ),
    );
    // Keyboard/switch focus: the shutter is an InkWell, not a GestureDetector.
    expect(
      find.ancestor(
        of: find.byIcon(Icons.camera_alt_outlined),
        matching: find.byType(InkWell),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('Choose from gallery'), findsOneWidget);
    final SemanticsNode gallery = tester.getSemantics(
      find.bySemanticsLabel('Choose from gallery'),
    );
    expect(gallery, isSemantics(isButton: true, hasTapAction: true));
    expect(find.bySemanticsLabel('Retake photo'), findsOneWidget);
    semantics.dispose();
  });
}
