import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/auth/auth_bloc.dart';
import 'package:proctira_mobile/core/auth/session_roles.dart';
import 'package:proctira_mobile/core/di/injector.dart';
import 'package:proctira_mobile/core/router/app_router.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/student/selected_student_store.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/home/presentation/home_screen.dart';

String _jwt(List<Map<String, String>> roles) {
  String seg(Object o) =>
      base64Url.encode(utf8.encode(jsonEncode(o))).replaceAll('=', '');
  return '${seg(<String, String>{'alg': 'none'})}.'
      '${seg(<String, Object>{'sub': 'u1', 'roles': roles})}.sig';
}

AuthState _auth(String token) => AuthState(
  status: AuthStatus.authenticated,
  userId: 'u1',
  accessToken: token,
);

final String _parent = _jwt(<Map<String, String>>[
  <String, String>{'roleId': 'parent', 'roleName': 'Parent'},
]);
final String _teacher = _jwt(<Map<String, String>>[
  <String, String>{'roleId': 'teacher', 'roleName': 'Teacher'},
]);

/// PRC-M040: role gating of staff routes and home tiles.
void main() {
  test('roles are read from the access token', () {
    expect(rolesFromAccessToken(_parent), containsAll(<String>['parent']));
    expect(rolesFromAccessToken('opaque'), isEmpty);
    expect(roleLabel(rolesFromAccessToken(_teacher)), 'Teacher');
  });

  String? go(String token, String location) => AppRouter.resolveRedirect(
    auth: _auth(token),
    hasTenant: true,
    location: location,
    uri: Uri.parse(location),
  );

  test('parent is redirected away from /attendance and staff deep links', () {
    expect(go(_parent, '/attendance'), '/parent');
    expect(go(_parent, '/students/stu-1'), '/parent');
    expect(go(_parent, '/reports'), '/parent');
    expect(go(_parent, '/assessments'), isNull);
  });

  test('unknown roles fail closed; staff passes', () {
    expect(go('opaque-token', '/attendance'), '/');
    expect(go(_teacher, '/attendance'), isNull);
  });

  test('login return path to a staff route is not honoured for parents', () {
    final Uri uri = Uri.parse('/login?from=%2Fattendance');
    expect(
      AppRouter.resolveRedirect(
        auth: _auth(_parent),
        hasTenant: true,
        location: '/login',
        uri: uri,
      ),
      '/parent',
    );
  });

  Future<void> pumpHome(WidgetTester tester, String token) async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    final SecureStorage storage = SecureStorage(const FlutterSecureStorage());
    await getIt.reset();
    getIt
      ..registerSingleton<TenantProvider>(TenantProvider(storage))
      ..registerSingleton<SelectedStudentStore>(SelectedStudentStore(storage));
    final AuthBloc bloc = AuthBloc(secureStorage: storage);
    bloc.emit(_auth(token)); // ignore: invalid_use_of_visible_for_testing_member
    addTearDown(() async {
      await bloc.close();
      await getIt.reset();
    });
    await tester.pumpWidget(
      BlocProvider<AuthBloc>.value(
        value: bloc,
        child: const MaterialApp(home: HomeScreen()),
      ),
    );
    await tester.pump();
  }

  testWidgets('parent role hides the attendance tile', (WidgetTester t) async {
    await pumpHome(t, _parent);
    expect(find.text('Attendance'), findsNothing);
    expect(find.text('Students'), findsNothing);
    expect(find.text('Assessments'), findsWidgets);
  });

  testWidgets('teacher sees the attendance tile', (WidgetTester t) async {
    await pumpHome(t, _teacher);
    expect(find.text('Attendance'), findsOneWidget);
  });
}
