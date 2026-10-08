import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/auth/token_refresh_policy.dart';

/// PRC-H013: a transient refresh failure must keep the session (and the
/// offline queue); only an authoritative token rejection forces logout.
void main() {
  RequestOptions req() => RequestOptions(path: '/api/v1/auth/refresh');

  group('shouldForceLogoutOnRefreshFailure', () {
    test('keeps session on receive timeout', () {
      final DioException e = DioException(
        requestOptions: req(),
        type: DioExceptionType.receiveTimeout,
      );
      expect(shouldForceLogoutOnRefreshFailure(e), isFalse);
    });

    test('keeps session on connection error', () {
      final DioException e = DioException(
        requestOptions: req(),
        type: DioExceptionType.connectionError,
      );
      expect(shouldForceLogoutOnRefreshFailure(e), isFalse);
    });

    test('keeps session on 500 from refresh', () {
      final DioException e = DioException(
        requestOptions: req(),
        type: DioExceptionType.badResponse,
        response: Response<dynamic>(requestOptions: req(), statusCode: 500),
      );
      expect(shouldForceLogoutOnRefreshFailure(e), isFalse);
    });

    test('keeps session on 503 from refresh', () {
      final DioException e = DioException(
        requestOptions: req(),
        type: DioExceptionType.badResponse,
        response: Response<dynamic>(requestOptions: req(), statusCode: 503),
      );
      expect(shouldForceLogoutOnRefreshFailure(e), isFalse);
    });

    test('keeps session on non-Dio error (malformed payload)', () {
      expect(
        shouldForceLogoutOnRefreshFailure(StateError('Invalid refresh payload')),
        isFalse,
      );
    });

    test('forces logout on 401 refresh rejection', () {
      final DioException e = DioException(
        requestOptions: req(),
        type: DioExceptionType.badResponse,
        response: Response<dynamic>(requestOptions: req(), statusCode: 401),
      );
      expect(shouldForceLogoutOnRefreshFailure(e), isTrue);
    });

    test('forces logout on 400 refresh rejection', () {
      final DioException e = DioException(
        requestOptions: req(),
        type: DioExceptionType.badResponse,
        response: Response<dynamic>(requestOptions: req(), statusCode: 400),
      );
      expect(shouldForceLogoutOnRefreshFailure(e), isTrue);
    });

    test('forces logout on 403 refresh rejection', () {
      final DioException e = DioException(
        requestOptions: req(),
        type: DioExceptionType.badResponse,
        response: Response<dynamic>(requestOptions: req(), statusCode: 403),
      );
      expect(shouldForceLogoutOnRefreshFailure(e), isTrue);
    });
  });
}
