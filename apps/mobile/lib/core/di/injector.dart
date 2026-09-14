import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:get_it/get_it.dart';
import 'package:local_auth/local_auth.dart';
import 'package:proctira_api_client/proctira_api_client.dart';

import '../../features/assessment/data/assessment_repository.dart';
import '../../features/attendance/data/attendance_repository.dart';
import '../../features/examination/data/examination_repository.dart';
import '../../features/health/data/health_repository.dart';
import '../../features/institutions/data/institution_repository.dart';
import '../../features/notifications/data/notification_repository.dart';
import '../../features/scholarship/data/scholarship_repository.dart';
import '../../features/students/data/student_repository.dart';
import '../auth/auth_bloc.dart';
import '../auth/biometric_service.dart';
import '../notifications/fcm_service.dart';
import '../notifications/local_notifications.dart';
import '../notifications/notification_router.dart';
import '../router/app_router.dart';
import '../storage/cache_crypto.dart';
import '../storage/database.dart';
import '../storage/secure_storage.dart';
import '../sync/connectivity_monitor.dart';
import '../sync/sync_dispatcher.dart';
import '../sync/sync_engine.dart';
import '../sync/sync_models.dart';
import '../tenant/tenant_provider.dart';

/// Global service locator. Use [configureDependencies] once at startup.
final GetIt getIt = GetIt.instance;

/// Default API base URL. Override with `--dart-define=API_BASE_URL=...`.
const String kDefaultApiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://127.0.0.1:3000',
);

bool _isAuthPublicPath(String path) {
  return path.contains('/api/v1/auth/login') ||
      path.contains('/api/v1/auth/refresh');
}

/// Registers all singletons. Idempotent so widget tests can call it safely.
Future<void> configureDependencies({String? apiBaseUrl}) async {
  if (getIt.isRegistered<SecureStorage>()) {
    return;
  }

  // Storage layer.
  const FlutterSecureStorage rawStorage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );
  final SecureStorage secureStorage = SecureStorage(rawStorage);
  getIt.registerSingleton<SecureStorage>(secureStorage);

  final CacheCrypto cacheCrypto =
      await CacheCrypto.fromSecureStorage(secureStorage);
  getIt.registerSingleton<CacheCrypto>(cacheCrypto);

  final AppDatabase database = AppDatabase();
  getIt.registerSingleton<AppDatabase>(database);

  // Tenant + auth services.
  final TenantProvider tenantProvider = TenantProvider(secureStorage);
  await tenantProvider.bootstrap();
  getIt.registerSingleton<TenantProvider>(tenantProvider);

  getIt.registerSingleton<LocalAuthentication>(LocalAuthentication());
  getIt.registerLazySingleton<BiometricService>(
    () =>
        BiometricService(getIt<LocalAuthentication>(), getIt<SecureStorage>()),
  );

  // HTTP client — tenant + Bearer interceptors. Refresh is best-effort on 401.
  final Dio dio = Dio(
    BaseOptions(
      baseUrl: apiBaseUrl ?? kDefaultApiBaseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30),
      headers: <String, dynamic>{'Content-Type': 'application/json'},
    ),
  );

  bool refreshInFlight = false;

  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest:
          (RequestOptions options, RequestInterceptorHandler handler) async {
        final String? tenantId = tenantProvider.tenantId;
        if (tenantId != null && tenantId.isNotEmpty) {
          options.headers['X-Tenant-ID'] = tenantId;
        }
        if (!_isAuthPublicPath(options.path)) {
          final String? access = await secureStorage.readAccessToken();
          if (access != null && access.isNotEmpty) {
            options.headers['Authorization'] = 'Bearer $access';
          }
        }
        handler.next(options);
      },
      onError: (DioException error, ErrorInterceptorHandler handler) async {
        final Response<dynamic>? response = error.response;
        final RequestOptions request = error.requestOptions;
        if (response?.statusCode != 401 ||
            _isAuthPublicPath(request.path) ||
            refreshInFlight ||
            request.extra['authRetried'] == true) {
          handler.next(error);
          return;
        }

        final String? refreshToken = await secureStorage.readRefreshToken();
        if (refreshToken == null || refreshToken.isEmpty) {
          handler.next(error);
          return;
        }

        refreshInFlight = true;
        try {
          final Response<dynamic> refreshResponse = await dio.post<dynamic>(
            '/api/v1/auth/refresh',
            data: <String, dynamic>{'refreshToken': refreshToken},
            options: Options(
              extra: <String, dynamic>{'authRetried': true},
            ),
          );
          final Object? body = refreshResponse.data;
          if (body is! Map<String, dynamic>) {
            throw StateError('Invalid refresh payload');
          }
          final AuthTokenPair tokens = AuthTokenPair.fromJson(body);
          await secureStorage.writeTokens(
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
          );

          final RequestOptions retry = request.copyWith(
            headers: <String, dynamic>{
              ...request.headers,
              'Authorization': 'Bearer ${tokens.accessToken}',
            },
            extra: <String, dynamic>{
              ...request.extra,
              'authRetried': true,
            },
          );
          final Response<dynamic> replay = await dio.fetch<dynamic>(retry);
          handler.resolve(replay);
        } catch (_) {
          await secureStorage.clearTokens();
          if (getIt.isRegistered<AuthBloc>()) {
            getIt<AuthBloc>().add(const AuthLogoutRequested());
          }
          handler.next(error);
        } finally {
          refreshInFlight = false;
        }
      },
    ),
  );
  getIt.registerSingleton<Dio>(dio);

  // API clients (typed wrappers around the shared Dio instance).
  getIt.registerLazySingleton<AuthApi>(() => AuthApi(getIt<Dio>()));
  getIt.registerLazySingleton<AttendanceApi>(() => AttendanceApi(getIt<Dio>()));
  getIt.registerLazySingleton<StudentApi>(() => StudentApi(getIt<Dio>()));
  getIt.registerLazySingleton<InstitutionApi>(
    () => InstitutionApi(getIt<Dio>()),
  );
  getIt.registerLazySingleton<NotificationDeviceApi>(
    () => NotificationDeviceApi(getIt<Dio>()),
  );
  getIt.registerLazySingleton<ReportApi>(
    () => ReportApi(getIt<Dio>()),
  );

  // Offline-first sync engine.
  getIt.registerLazySingleton<ConnectivityMonitor>(
    () => RealConnectivityMonitor(),
  );
  getIt.registerLazySingleton<SyncEngine>(() {
    final SyncEngine engine = SyncEngine(
      database: getIt<AppDatabase>(),
      tenantProvider: getIt<TenantProvider>(),
      connectivity: getIt<ConnectivityMonitor>(),
      dispatchers: <SyncEntityType, SyncDispatcher>{
        SyncEntityType.attendance:
            AttendanceSyncDispatcher(getIt<AttendanceApi>()),
      },
    );
    engine.start();
    return engine;
  });

  // Feature repositories.
  getIt.registerLazySingleton<NotificationRepository>(
    () => NotificationRepository(
      database: getIt<AppDatabase>(),
      tenantProvider: getIt<TenantProvider>(),
    ),
  );
  getIt.registerLazySingleton<InstitutionRepository>(
    () => InstitutionRepository(
      database: getIt<AppDatabase>(),
      tenantProvider: getIt<TenantProvider>(),
      api: getIt<InstitutionApi>(),
    ),
  );
  getIt.registerLazySingleton<StudentRepository>(
    () => StudentRepository(
      database: getIt<AppDatabase>(),
      tenantProvider: getIt<TenantProvider>(),
      syncEngine: getIt<SyncEngine>(),
      cacheCrypto: getIt<CacheCrypto>(),
      studentApi: getIt<StudentApi>(),
    ),
  );
  getIt.registerLazySingleton<AttendanceRepository>(
    () => AttendanceRepository(
      database: getIt<AppDatabase>(),
      tenantProvider: getIt<TenantProvider>(),
      syncEngine: getIt<SyncEngine>(),
      cacheCrypto: getIt<CacheCrypto>(),
      studentApi: getIt<StudentApi>(),
    ),
  );
  getIt.registerLazySingleton<ScholarshipRepository>(
    () => ScholarshipRepository(
      database: getIt<AppDatabase>(),
      tenantProvider: getIt<TenantProvider>(),
      dio: getIt<Dio>(),
    ),
  );
  getIt.registerLazySingleton<HealthRepository>(
    () => HealthRepository(
      database: getIt<AppDatabase>(),
      tenantProvider: getIt<TenantProvider>(),
      dio: getIt<Dio>(),
      cacheCrypto: getIt<CacheCrypto>(),
    ),
  );
  getIt.registerLazySingleton<ExaminationRepository>(
    () => ExaminationRepository(
      database: getIt<AppDatabase>(),
      tenantProvider: getIt<TenantProvider>(),
      dio: getIt<Dio>(),
    ),
  );
  getIt.registerLazySingleton<AssessmentRepository>(
    () => AssessmentRepository(
      database: getIt<AppDatabase>(),
      tenantProvider: getIt<TenantProvider>(),
      dio: getIt<Dio>(),
    ),
  );

  // Notification plumbing. [FcmService.start] is intentionally NOT called
  // here — the app's `main()` invokes it after `runApp` so the UI can render
  // even when Firebase config files are missing on the device.
  getIt.registerLazySingleton<NotificationRouter>(
    () => const NotificationRouter(),
  );
  getIt.registerLazySingleton<LocalNotifications>(() => LocalNotifications());
  getIt.registerLazySingleton<FcmService>(
    () => FcmService(
      deviceApi: getIt<NotificationDeviceApi>(),
      repository: getIt<NotificationRepository>(),
      router: getIt<NotificationRouter>(),
      localNotifications: getIt<LocalNotifications>(),
    ),
  );

  // Auth bloc + router.
  final AuthBloc authBloc = AuthBloc(
    secureStorage: secureStorage,
    database: database,
    authApi: getIt<AuthApi>(),
  );
  getIt.registerSingleton<AuthBloc>(authBloc);

  getIt.registerLazySingleton<AppRouter>(() => AppRouter(authBloc));
}

/// Reset the locator. Intended for tests.
Future<void> resetDependencies() async {
  if (getIt.isRegistered<AuthBloc>()) {
    await getIt<AuthBloc>().close();
  }
  if (getIt.isRegistered<SyncEngine>()) {
    await getIt<SyncEngine>().stop();
  }
  if (getIt.isRegistered<AppDatabase>()) {
    await getIt<AppDatabase>().close();
  }
  await getIt.reset();
}
