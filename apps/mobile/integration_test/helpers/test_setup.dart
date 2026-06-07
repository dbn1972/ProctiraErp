import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:openemis_mobile/app/app.dart';
import 'package:openemis_mobile/core/auth/auth_bloc.dart';
import 'package:openemis_mobile/core/di/injector.dart';
import 'package:openemis_mobile/core/storage/database.dart';
import 'package:openemis_mobile/core/sync/connectivity_monitor.dart';
import 'package:openemis_mobile/core/sync/sync_dispatcher.dart';
import 'package:openemis_mobile/core/sync/sync_engine.dart';
import 'package:openemis_mobile/core/sync/sync_models.dart';
import 'package:openemis_mobile/core/tenant/tenant_provider.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// One-time platform initialisation shared by every journey test:
/// - swap [databaseFactory] for the FFI implementation so SQLite runs in
///   process,
/// - point the secure-storage plugin at its in-memory mock so we never touch
///   the host keychain,
/// - silence Google Fonts' runtime download (the host has no network),
/// - stub the platform channels we don't ship in unit tests
///   (local_auth, geolocator, image_picker, permission_handler, ...).
void initialiseTestPlatform() {
  TestWidgetsFlutterBinding.ensureInitialized();
  if (!_dbFactoryConfigured) {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    _dbFactoryConfigured = true;
  }
  FlutterSecureStorage.setMockInitialValues(<String, String>{});
  GoogleFonts.config.allowRuntimeFetching = false;
  _stubPlatformChannels();
}

bool _dbFactoryConfigured = false;
bool _platformChannelsStubbed = false;

void _stubPlatformChannels() {
  if (_platformChannelsStubbed) return;
  final TestDefaultBinaryMessenger messenger =
      TestWidgetsFlutterBinding.instance.defaultBinaryMessenger;

  // local_auth: report the device as not supporting biometrics so the login
  // screen skips the optional fingerprint button without crashing.
  messenger.setMockMethodCallHandler(
    const MethodChannel('plugins.flutter.io/local_auth'),
    (MethodCall call) async {
      switch (call.method) {
        case 'isDeviceSupported':
        case 'canCheckBiometrics':
          return false;
        case 'getAvailableBiometrics':
          return <String>[];
        case 'authenticate':
          return false;
        case 'stopAuthentication':
          return true;
      }
      return null;
    },
  );

  // path_provider: docs dir queries should resolve to the system temp dir.
  messenger.setMockMethodCallHandler(
    const MethodChannel('plugins.flutter.io/path_provider'),
    (MethodCall call) async {
      return Directory.systemTemp.path;
    },
  );

  // connectivity_plus: real plugin isn't loaded — the app injects the fake
  // monitor anyway, but the platform interface still queries the channel
  // when a real instance is constructed by accident.
  messenger.setMockMethodCallHandler(
    const MethodChannel('dev.fluttercommunity.plus/connectivity'),
    (MethodCall call) async => <int>[6], // wifi
  );
  messenger.setMockMethodCallHandler(
    const MethodChannel('dev.fluttercommunity.plus/connectivity_status'),
    (MethodCall call) async => null,
  );

  // permission_handler / geolocator stubs: respond with reasonable defaults
  // so screens that probe permissions don't throw.
  messenger.setMockMethodCallHandler(
    const MethodChannel('flutter.baseflow.com/permissions/methods'),
    (MethodCall call) async => 0,
  );
  messenger.setMockMethodCallHandler(
    const MethodChannel('flutter.baseflow.com/geolocator'),
    (MethodCall call) async => null,
  );

  _platformChannelsStubbed = true;
}

/// Bundle of test doubles that journey tests can introspect after the app has
/// been pumped. The fixture owns the DB / connectivity / dispatcher so the
/// test can assert against them and tear them down deterministically.
class JourneyHarness {
  JourneyHarness({
    required this.tempDir,
    required this.connectivity,
    required this.recordingDispatcher,
  });

  final Directory tempDir;
  final FakeConnectivityMonitor connectivity;
  final RecordingSyncDispatcher recordingDispatcher;

  AppDatabase get database => getIt<AppDatabase>();
  TenantProvider get tenantProvider => getIt<TenantProvider>();
  SyncEngine get syncEngine => getIt<SyncEngine>();
  AuthBloc get authBloc => getIt<AuthBloc>();

  /// Manually mark the user as authenticated so the router redirects past
  /// `/login`. Useful for journey tests that don't want to drive the form.
  Future<void> markAuthenticated({
    String userId = 'test-user',
    String accessToken = 'test-access',
    String refreshToken = 'test-refresh',
  }) async {
    final AuthBloc bloc = authBloc;
    bloc.add(
      AuthLoggedIn(
        userId: userId,
        accessToken: accessToken,
        refreshToken: refreshToken,
      ),
    );
    await _waitForState(
      bloc,
      (AuthState s) => s.isAuthenticated && s.userId == userId,
    );
  }

  /// Drive the bootstrap event so the router resolves redirects.
  Future<void> bootstrapAuth() async {
    final AuthBloc bloc = authBloc;
    bloc.add(const AuthBootstrapRequested());
    await _waitForState(bloc, (AuthState s) => s.isResolved);
  }

  Future<void> _waitForState(
    AuthBloc bloc,
    bool Function(AuthState state) matcher, {
    Duration timeout = const Duration(seconds: 2),
  }) async {
    if (matcher(bloc.state)) return;
    await bloc.stream
        .firstWhere(matcher)
        .timeout(timeout);
  }

  Future<void> dispose() async {
    await resetDependencies();
    await connectivity.dispose();
    if (await tempDir.exists()) {
      await tempDir.delete(recursive: true);
    }
  }
}

/// Bootstrap [getIt] with deterministic test doubles:
/// - [AppDatabase] persisted to a temp file (FFI),
/// - [FakeConnectivityMonitor] starting offline,
/// - [RecordingSyncDispatcher] that captures every dispatch call,
/// - secure-storage seeded with the supplied [tenantId] when provided.
Future<JourneyHarness> bootstrapTestApp({
  String? tenantId,
  String? tenantDisplayName,
  bool startsOnline = false,
  Map<String, String> initialSecureStorage = const <String, String>{},
}) async {
  initialiseTestPlatform();

  final Map<String, String> seed = <String, String>{...initialSecureStorage};
  if (tenantId != null) {
    seed['tenant.id'] = tenantId;
    if (tenantDisplayName != null) {
      seed['tenant.display_name'] = tenantDisplayName;
    }
  }
  FlutterSecureStorage.setMockInitialValues(seed);

  // Reset any leftover registrations from a prior test in the same isolate.
  await resetDependencies();

  await configureDependencies(apiBaseUrl: 'http://test.invalid');

  // Replace the production database with one rooted in a temp file so each
  // test starts with a clean store.
  final Directory tempDir =
      await Directory.systemTemp.createTemp('openemis_int_');
  final AppDatabase tempDb =
      AppDatabase(overridePath: '${tempDir.path}/openemis.db');
  await getIt.unregister<AppDatabase>(
    instance: getIt<AppDatabase>(),
    disposingFunction: (AppDatabase d) => d.close(),
  );
  getIt.registerSingleton<AppDatabase>(tempDb);

  // Replace the Dio adapter with one that fails any unexpected outbound
  // request. Tests that need a controlled response should re-register Dio.
  final Dio dio = getIt<Dio>();
  dio.httpClientAdapter = _ExplodingHttpAdapter();

  // Swap in the fake connectivity monitor and the recording dispatcher.
  final FakeConnectivityMonitor connectivity =
      FakeConnectivityMonitor(startsOnline: startsOnline);
  await _replaceConnectivity(connectivity);
  final RecordingSyncDispatcher dispatcher = RecordingSyncDispatcher();
  await _replaceSyncEngine(dispatcher);

  return JourneyHarness(
    tempDir: tempDir,
    connectivity: connectivity,
    recordingDispatcher: dispatcher,
  );
}

Future<void> _replaceConnectivity(FakeConnectivityMonitor connectivity) async {
  if (getIt.isRegistered<ConnectivityMonitor>()) {
    await getIt.unregister<ConnectivityMonitor>();
  }
  getIt.registerLazySingleton<ConnectivityMonitor>(() => connectivity);
}

Future<void> _replaceSyncEngine(RecordingSyncDispatcher dispatcher) async {
  if (getIt.isRegistered<SyncEngine>()) {
    final SyncEngine existing = getIt<SyncEngine>();
    await existing.stop();
    await getIt.unregister<SyncEngine>();
  }
  getIt.registerLazySingleton<SyncEngine>(() {
    final SyncEngine engine = SyncEngine(
      database: getIt<AppDatabase>(),
      tenantProvider: getIt<TenantProvider>(),
      connectivity: getIt<ConnectivityMonitor>(),
      dispatchers: <SyncEntityType, SyncDispatcher>{
        SyncEntityType.attendance: dispatcher,
        SyncEntityType.student: dispatcher,
        SyncEntityType.enrollment: dispatcher,
      },
      baseBackoff: Duration.zero,
    );
    engine.start();
    return engine;
  });
}

/// Top-level widget pumped by every journey test. Wraps
/// [MaterialApp.router] using the production [AppRouter] so guards,
/// redirects, and theming all behave like the real app.
Widget buildJourneyApp() {
  return const OpenEmisApp();
}

/// Pump the app and wait for first-frame settle. The harness waits an extra
/// frame to give GoRouter time to resolve auth/tenant redirects.
Future<void> pumpJourneyApp(WidgetTester tester) async {
  await tester.pumpWidget(buildJourneyApp());
  await tester.pumpAndSettle(const Duration(milliseconds: 200));
}

/// Recording sync dispatcher used by integration tests. Captures every
/// [PendingSyncRow] passed through [dispatch] so tests can assert that the
/// engine attempted to flush them. Returns a configurable [DispatchOutcome]
/// (transient by default to keep rows queued).
class RecordingSyncDispatcher implements SyncDispatcher {
  RecordingSyncDispatcher({
    DispatchOutcome Function(PendingSyncRow row)? outcomeFactory,
  }) : _outcomeFactory =
            outcomeFactory ?? ((PendingSyncRow _) => const DispatchTransient('test'));

  final DispatchOutcome Function(PendingSyncRow row) _outcomeFactory;
  final List<PendingSyncRow> received = <PendingSyncRow>[];

  bool get wasInvoked => received.isNotEmpty;

  @override
  Future<DispatchOutcome> dispatch(PendingSyncRow row) async {
    received.add(row);
    return _outcomeFactory(row);
  }
}

/// Dio adapter that throws on any outbound request. Tests opt-in to network
/// by replacing the adapter on a per-fixture basis.
class _ExplodingHttpAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    throw StateError(
      'Unexpected network call during integration test: '
      '${options.method} ${options.uri}',
    );
  }

  @override
  void close({bool force = false}) {}
}

/// Helper: count rows in a sqlite table for the active tenant.
Future<int> tableRowCount(
  AppDatabase database,
  String table, {
  String? whereTenant,
}) async {
  final Database raw = await database.database;
  final List<Map<String, Object?>> rows = await raw.rawQuery(
    whereTenant == null
        ? 'SELECT COUNT(*) AS c FROM $table'
        : 'SELECT COUNT(*) AS c FROM $table WHERE tenant_id = ?',
    whereTenant == null ? null : <Object>[whereTenant],
  );
  return (rows.first['c'] as num?)?.toInt() ?? 0;
}
