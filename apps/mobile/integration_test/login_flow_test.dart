import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:proctira_mobile/core/auth/auth_bloc.dart';
import 'package:proctira_mobile/core/di/injector.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';

import 'helpers/test_setup.dart';

/// PRC-M563: login journey driven through the real [LoginScreen] → AuthApi →
/// Dio stack. Only the HTTP adapter is faked, so skipping AuthApi, dropping
/// the tenant header or not persisting tokens makes these tests fail.
class _FakeAuthAdapter implements HttpClientAdapter {
  _FakeAuthAdapter({required this.succeed});

  final bool succeed;
  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    if (!options.path.endsWith('/api/v1/auth/login')) {
      // Post-login screens may fetch data; keep them empty but valid.
      return ResponseBody.fromString(
        jsonEncode(<String, dynamic>{'data': <Object>[]}),
        200,
        headers: <String, List<String>>{
          Headers.contentTypeHeader: <String>['application/json'],
        },
      );
    }
    if (!succeed) {
      return ResponseBody.fromString(
        jsonEncode(<String, dynamic>{
          'code': 'INVALID_CREDENTIALS',
          'message': 'Invalid email or password',
          'statusCode': 401,
        }),
        401,
        headers: <String, List<String>>{
          Headers.contentTypeHeader: <String>['application/json'],
        },
      );
    }
    return ResponseBody.fromString(
      jsonEncode(<String, dynamic>{
        'tokens': <String, dynamic>{
          'accessToken': 'access-from-api',
          'refreshToken': 'refresh-from-api',
          'expiresIn': 900,
        },
        'user': <String, dynamic>{
          'userId': 'teacher-1',
          'email': 'teacher@school.edu',
          'displayName': 'Teacher',
        },
      }),
      200,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Future<void> _submitCredentials(WidgetTester tester) async {
  await tester.enterText(
    find.widgetWithText(TextFormField, 'Email or phone'),
    'teacher@school.edu',
  );
  await tester.enterText(
    find.widgetWithText(TextFormField, 'Password'),
    'password123',
  );
  await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
  // Real Dio + secure-storage futures complete outside fake time.
  await tester.runAsync(
    () => Future<void>.delayed(const Duration(milliseconds: 200)),
  );
  await tester.pumpAndSettle(const Duration(milliseconds: 300));
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('valid credentials: API login → tokens stored → home route', (
    WidgetTester tester,
  ) async {
    final JourneyHarness harness = await bootstrapTestApp(
      tenantId: 'tenant-login-test',
      tenantDisplayName: 'Login Test School',
    );
    addTearDown(harness.dispose);
    final _FakeAuthAdapter adapter = _FakeAuthAdapter(succeed: true);
    getIt<Dio>().httpClientAdapter = adapter;

    await harness.bootstrapAuth();
    await pumpJourneyApp(tester);
    expect(currentJourneyPath(), '/login');

    await _submitCredentials(tester);

    final RequestOptions login = adapter.requests.firstWhere(
      (RequestOptions r) => r.path.endsWith('/api/v1/auth/login'),
    );
    expect(login.method, 'POST');
    expect(login.headers['X-Tenant-ID'], 'tenant-login-test');
    expect(
      (login.data as Map<String, dynamic>)['username'],
      'teacher@school.edu',
    );

    expect(harness.authBloc.state.status, AuthStatus.authenticated);
    expect(harness.authBloc.state.userId, 'teacher-1');
    final SecureStorage storage = getIt<SecureStorage>();
    expect(await storage.readAccessToken(), 'access-from-api');
    expect(await storage.readRefreshToken(), 'refresh-from-api');
    expect(currentJourneyPath(), '/');
  });

  testWidgets('401 from the API: error shown, still on /login, no tokens', (
    WidgetTester tester,
  ) async {
    final JourneyHarness harness = await bootstrapTestApp(
      tenantId: 'tenant-login-test',
      tenantDisplayName: 'Login Test School',
    );
    addTearDown(harness.dispose);
    getIt<Dio>().httpClientAdapter = _FakeAuthAdapter(succeed: false);

    await harness.bootstrapAuth();
    await pumpJourneyApp(tester);
    await _submitCredentials(tester);

    expect(find.text('Invalid email or password'), findsOneWidget);
    expect(harness.authBloc.state.isAuthenticated, isFalse);
    expect(await getIt<SecureStorage>().readAccessToken(), isNull);
    expect(currentJourneyPath(), '/login');
  });

  testWidgets('already authenticated user is redirected to home', (
    WidgetTester tester,
  ) async {
    final JourneyHarness harness = await bootstrapTestApp(
      tenantId: 'tenant-auth-redirect',
      tenantDisplayName: 'Auth Redirect School',
      initialSecureStorage: <String, String>{
        'auth.access_token': 'existing-access-token',
        'auth.refresh_token': 'existing-refresh-token',
      },
    );
    addTearDown(harness.dispose);
    await harness.bootstrapAuth();
    await pumpJourneyApp(tester);

    expect(harness.authBloc.state.isAuthenticated, isTrue);
    expect(currentJourneyPath(), '/');
  });
}
