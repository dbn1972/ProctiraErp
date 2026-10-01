import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/notifications/notification_router.dart';
import 'package:proctira_mobile/core/router/app_router.dart';

void main() {
  group('PRC-L006 entityId validation', () {
    test('valid uuid is routed', () {
      expect(
        routeForPayload(<String, dynamic>{
          'type': 'STUDENT_TRANSFER',
          'entityId': '3f2b8c1e-0d7a-4c1b-9a4e-1b2c3d4e5f60',
        }),
        '/students/3f2b8c1e-0d7a-4c1b-9a4e-1b2c3d4e5f60',
      );
    });

    for (final String bad in <String>[
      '../profile',
      'abc/def',
      'x?studentId=evil',
      '%2e%2e',
      '',
      ' ',
      'a' * 65,
      '-leading-dash',
    ]) {
      test('malformed entityId "$bad" falls back to list route', () {
        expect(
          routeForPayload(<String, dynamic>{
            'type': 'STUDENT_TRANSFER',
            'entityId': bad,
          }),
          '/students',
        );
        expect(
          routeForPayload(<String, dynamic>{
            'type': 'REPORT_READY',
            'entityId': bad,
          }),
          '/reports',
        );
        expect(
          routeForPayload(<String, dynamic>{
            'type': 'INSTITUTION_UPDATE',
            'entityId': bad,
          }),
          '/institutions',
        );
      });
    }

    test('non-string entityId is ignored', () {
      expect(
        routeForPayload(<String, dynamic>{
          'type': 'REPORT_READY',
          'entityId': 42,
        }),
        '/reports',
      );
    });
  });

  group('PRC-L006 logged-out deep link resumes after login', () {
    test('cold-start target is carried through ?from= and restored', () {
      final String login = AppRouter.loginLocationFor(
        Uri.parse('/students/stu-1'),
      );
      expect(login, startsWith('/login?from='));
      final Uri loginUri = Uri.parse(login);
      expect(
        AppRouter.safeReturnPath(loginUri.queryParameters['from']),
        '/students/stu-1',
      );
    });

    test('query string of the target survives the round trip', () {
      final String login = AppRouter.loginLocationFor(
        Uri.parse('/examinations?studentId=s-9'),
      );
      expect(
        AppRouter.safeReturnPath(Uri.parse(login).queryParameters['from']),
        '/examinations?studentId=s-9',
      );
    });

    test('root target uses plain /login', () {
      expect(AppRouter.loginLocationFor(Uri.parse('/')), '/login');
    });

    for (final String bad in <String>[
      'https://evil.example/x',
      '//evil.example/x',
      r'/\evil.example',
      'students',
      '/login',
      '/login?from=/x',
      '/tenant',
    ]) {
      test('unsafe return path "$bad" is rejected', () {
        expect(AppRouter.safeReturnPath(bad), isNull);
      });
    }

    test('missing from falls back to null', () {
      expect(AppRouter.safeReturnPath(null), isNull);
    });
  });
}
