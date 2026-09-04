import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get_it/get_it.dart';
import 'package:proctira_mobile/core/auth/auth_bloc.dart';
import 'package:proctira_mobile/core/l10n/app_localizations.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/auth/data/auth_repository.dart';
import 'package:proctira_mobile/features/profile/bloc/profile_bloc.dart';
import 'package:proctira_mobile/features/profile/presentation/profile_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late SecureStorage storage;
  late AuthRepository authRepository;

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{
      SecureStorage.userIdKey: 'user-42',
      SecureStorage.userDisplayNameKey: 'Priya Nair',
      SecureStorage.userEmailKey: 'priya@school.gov',
      SecureStorage.userRoleKey: 'teacher',
      SecureStorage.tenantIdKey: 'demo-school',
      SecureStorage.tenantNameKey: 'Demo School',
    });
    await GetIt.I.reset();

    storage = SecureStorage(const FlutterSecureStorage());
    final Dio dio = Dio(BaseOptions(baseUrl: 'https://example.test'));
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (RequestOptions options, RequestInterceptorHandler handler) {
          handler.resolve(
            Response<dynamic>(
              requestOptions: options,
              statusCode: 200,
              data: <String, dynamic>{
                'userId': 'user-42',
                'email': 'priya@school.gov',
                'displayName': 'Priya Nair',
                'roles': <String>['teacher'],
                'tenantId': 'demo-school',
              },
            ),
          );
        },
      ),
    );
    authRepository = AuthRepository(dio: dio);

    final TenantProvider tenant = TenantProvider(storage);
    await tenant.bootstrap();
    GetIt.I.registerSingleton<SecureStorage>(storage);
    GetIt.I.registerSingleton<TenantProvider>(tenant);
    GetIt.I.registerSingleton<AuthRepository>(authRepository);
    GetIt.I.registerSingleton<AuthBloc>(AuthBloc(secureStorage: storage));
  });

  tearDown(() async {
    if (GetIt.I.isRegistered<AuthBloc>()) {
      await GetIt.I<AuthBloc>().close();
    }
    await GetIt.I.reset();
  });

  testWidgets('ProfileScreen shows real user from /auth/me + storage',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: BlocProvider<AuthBloc>.value(
          value: GetIt.I<AuthBloc>(),
          child: const ProfileScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Priya Nair'), findsWidgets);
    expect(find.textContaining('priya@school.gov'), findsOneWidget);
    expect(find.textContaining('Demo School'), findsWidgets);
  });

  test('ProfileBloc loads cached profile then refreshes from API', () async {
    final ProfileBloc bloc = ProfileBloc(
      secureStorage: storage,
      authRepository: authRepository,
    );
    bloc.add(const ProfileLoaded());
    await expectLater(
      bloc.stream,
      emitsThrough(
        predicate<ProfileState>(
          (ProfileState s) =>
              s.status == ProfileStatus.loaded &&
              s.displayName == 'Priya Nair' &&
              s.email == 'priya@school.gov' &&
              s.role == 'teacher',
        ),
      ),
    );
    await bloc.close();
  });
}
