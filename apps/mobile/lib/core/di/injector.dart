import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:get_it/get_it.dart';
import 'package:local_auth/local_auth.dart';
import 'package:proctira_api_client/proctira_api_client.dart';

import '../../features/auth/data/auth_repository.dart';
import '../../features/assessment/data/assessment_repository.dart';
import '../../features/examination/data/examination_repository.dart';
import '../../features/health/data/health_repository.dart';
import '../../features/institutions/data/institution_repository.dart';
import '../../features/notifications/data/notification_repository.dart';
import '../../features/scholarship/data/scholarship_repository.dart';
import '../../features/staff/data/staff_repository.dart';
import '../../features/survey/data/survey_repository.dart';
import '../../features/transport/data/transport_repository.dart';
import '../../features/workflow/data/workflow_repository.dart';
import '../auth/auth_bloc.dart';
import '../auth/biometric_service.dart';
import '../notifications/fcm_service.dart';
import '../notifications/local_notifications.dart';
import '../notifications/notification_router.dart';
import '../router/app_router.dart';
import '../storage/database.dart';
import '../storage/secure_storage.dart';
import '../sync/connectivity_monitor.dart';
import '../sync/sync_dispatcher.dart';
import '../sync/sync_engine.dart';
import '../sync/sync_models.dart';
import '../tenant/tenant_provider.dart';

/// Global service locator. Use [configureDependencies] once at startup.
final GetIt getIt = GetIt.instance;

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

  final AppDatabase database = AppDatabase();
  getIt.registerSingleton<AppDatabase>(database);

  // Tenant + auth services.
  final TenantProvider tenantProvider = TenantProvider(secureStorage);
  await tenantProvider.bootstrap();
  getIt.registerSingleton<TenantProvider>(tenantProvider);

  getIt.registerSingleton<LocalAuthentication>(LocalAuthentication());
  getIt.registerLazySingleton<BiometricService>(
    () => BiometricService(getIt<LocalAuthentication>(), getIt<SecureStorage>()),
  );

  // HTTP client (tenant + bearer headers injected automatically).
  final Dio dio = Dio(
    BaseOptions(
      baseUrl: apiBaseUrl ?? 'https://api.openemis.org',
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30),
      headers: <String, dynamic>{'Content-Type': 'application/json'},
    ),
  );
  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (RequestOptions options, RequestInterceptorHandler handler) async {
        final String? tenantId = tenantProvider.tenantId;
        if (tenantId != null && tenantId.isNotEmpty) {
          options.headers['X-Tenant-ID'] = tenantId;
        }
        final String? access = await secureStorage.readAccessToken();
        if (access != null && access.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $access';
        }
        handler.next(options);
      },
    ),
  );
  getIt.registerSingleton<Dio>(dio);

  getIt.registerLazySingleton<AuthRepository>(
    () => AuthRepository(dio: getIt<Dio>()),
  );

  // API clients (typed wrappers around the shared Dio instance — they all
  // benefit from the X-Tenant-ID interceptor configured above).
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
        SyncEntityType.attendance: AttendanceSyncDispatcher(getIt<AttendanceApi>()),
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
  getIt.registerLazySingleton<ScholarshipRepository>(
    () => ScholarshipRepository(
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
  getIt.registerLazySingleton<ExaminationRepository>(
    () => ExaminationRepository(
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
    ),
  );
  getIt.registerLazySingleton<StaffRepository>(
    () => StaffRepository(dio: getIt<Dio>()),
  );
  getIt.registerLazySingleton<TransportRepository>(
    () => TransportRepository(dio: getIt<Dio>()),
  );
  getIt.registerLazySingleton<WorkflowRepository>(
    () => WorkflowRepository(dio: getIt<Dio>()),
  );
  getIt.registerLazySingleton<SurveyRepository>(
    () => SurveyRepository(dio: getIt<Dio>()),
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
  final AuthBloc authBloc = AuthBloc(secureStorage: secureStorage);
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
