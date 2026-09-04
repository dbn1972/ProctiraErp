import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/features/auth/data/auth_repository.dart';

Dio _dioWithResponder(
  Future<Response<dynamic>> Function(RequestOptions) respond,
) {
  final Dio dio = Dio(BaseOptions(baseUrl: 'https://example.test'));
  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (RequestOptions options, RequestInterceptorHandler handler) async {
        try {
          final Response<dynamic> response = await respond(options);
          handler.resolve(response);
        } catch (error) {
          if (error is DioException) {
            handler.reject(error);
          } else {
            handler.reject(
              DioException(requestOptions: options, error: error),
            );
          }
        }
      },
    ),
  );
  return dio;
}

void main() {
  group('AuthRepository', () {
    test('login parses legacy wrapped token response', () async {
      final AuthRepository repo = AuthRepository(
        dio: _dioWithResponder((RequestOptions options) async {
          expect(options.path, '/api/v1/auth/login');
          return Response<dynamic>(
            requestOptions: options,
            statusCode: 200,
            data: <String, dynamic>{
              'tokens': <String, dynamic>{
                'accessToken': 'access-1',
                'refreshToken': 'refresh-1',
              },
              'user': <String, dynamic>{
                'userId': 'u-1',
                'displayName': 'Ada',
              },
            },
          );
        }),
      );

      final AuthSession session = await repo.login(
        username: 'ada@school.gov',
        password: 'secret',
      );
      expect(session.userId, 'u-1');
      expect(session.accessToken, 'access-1');
      expect(session.refreshToken, 'refresh-1');
      expect(session.displayName, 'Ada');
    });

    test('login falls back to Keycloak password grant on 404', () async {
      int calls = 0;
      final AuthRepository repo = AuthRepository(
        dio: _dioWithResponder((RequestOptions options) async {
          calls += 1;
          if (options.path == '/api/v1/auth/login') {
            throw DioException(
              requestOptions: options,
              response: Response<dynamic>(
                requestOptions: options,
                statusCode: 404,
              ),
              type: DioExceptionType.badResponse,
            );
          }
          expect(options.path, '/api/v1/auth/password');
          return Response<dynamic>(
            requestOptions: options,
            statusCode: 200,
            data: <String, dynamic>{
              'accessToken': 'kc-access',
              'refreshToken': 'kc-refresh',
              'user': <String, dynamic>{'email': 'ada@school.gov'},
            },
          );
        }),
      );

      final AuthSession session = await repo.login(
        username: 'ada@school.gov',
        password: 'secret',
      );
      expect(calls, 2);
      expect(session.accessToken, 'kc-access');
      expect(session.refreshToken, 'kc-refresh');
      expect(session.userId, 'ada@school.gov');
    });

    test('refresh parses flat Keycloak response', () async {
      final AuthRepository repo = AuthRepository(
        dio: _dioWithResponder((RequestOptions options) async {
          expect(options.path, '/api/v1/auth/refresh');
          return Response<dynamic>(
            requestOptions: options,
            statusCode: 200,
            data: <String, dynamic>{
              'accessToken': 'new-access',
              'refreshToken': 'new-refresh',
            },
          );
        }),
      );

      final AuthSession session = await repo.refresh('old-refresh');
      expect(session.accessToken, 'new-access');
      expect(session.refreshToken, 'new-refresh');
    });

    test('login surfaces auth error message', () async {
      final AuthRepository repo = AuthRepository(
        dio: _dioWithResponder((RequestOptions options) async {
          throw DioException(
            requestOptions: options,
            response: Response<dynamic>(
              requestOptions: options,
              statusCode: 401,
              data: <String, dynamic>{
                'message': 'Invalid username or password',
              },
            ),
            type: DioExceptionType.badResponse,
          );
        }),
      );

      expect(
        () => repo.login(username: 'x', password: 'y'),
        throwsA(
          isA<AuthException>().having(
            (AuthException e) => e.message,
            'message',
            'Invalid username or password',
          ),
        ),
      );
    });
    test('fetchCurrentUser parses legacy /auth/me payload', () async {
      final AuthRepository repo = AuthRepository(
        dio: _dioWithResponder((RequestOptions options) async {
          expect(options.path, '/api/v1/auth/me');
          return Response<dynamic>(
            requestOptions: options,
            statusCode: 200,
            data: <String, dynamic>{
              'userId': 'u-9',
              'email': 'me@school.gov',
              'displayName': 'Me User',
              'roles': <String>['parent'],
              'tenantId': 't-1',
            },
          );
        }),
      );

      final AuthUserProfile profile = await repo.fetchCurrentUser();
      expect(profile.userId, 'u-9');
      expect(profile.email, 'me@school.gov');
      expect(profile.displayName, 'Me User');
      expect(profile.role, 'parent');
      expect(profile.tenantId, 't-1');
    });
  });
}
