import 'package:dio/dio.dart';

import '../models/auth_tokens.dart';
import 'api_client.dart';

/// Typed wrapper around gateway auth endpoints (`/api/v1/auth/*`).
///
/// Upstream auth-service paths are `/auth/login|refresh|logout|me`; the API
/// gateway rewrites `/api/v1/auth/*` → `/auth/*`. Mobile always talks to the
/// gateway base URL so tenant + Bearer interceptors stay consistent.
class AuthApi extends BaseApi {
  AuthApi(super.dio);

  static const String _basePath = '/api/v1/auth';

  /// Authenticate with username/email + password.
  ///
  /// Requires `X-Tenant-ID` (injected by the app Dio interceptor).
  Future<AuthLoginResult> login({
    required String username,
    required String password,
  }) async {
    final Response<dynamic> response = await request<dynamic>(
      '$_basePath/login',
      method: 'POST',
      data: <String, dynamic>{
        'username': username,
        'password': password,
      },
    );
    final Object? body = response.data;
    if (body is Map<String, dynamic>) {
      return AuthLoginResult.fromJson(body);
    }
    throw FormatException('Unexpected login response: $body');
  }

  /// Rotate the refresh token into a new access/refresh pair.
  Future<AuthTokenPair> refresh({required String refreshToken}) async {
    final Response<dynamic> response = await request<dynamic>(
      '$_basePath/refresh',
      method: 'POST',
      data: <String, dynamic>{'refreshToken': refreshToken},
    );
    final Object? body = response.data;
    if (body is Map<String, dynamic>) {
      return AuthTokenPair.fromJson(body);
    }
    throw FormatException('Unexpected refresh response: $body');
  }

  /// Best-effort server logout (invalidate session / refresh token).
  Future<void> logout({String? refreshToken}) async {
    await request<dynamic>(
      '$_basePath/logout',
      method: 'POST',
      data: refreshToken == null
          ? const <String, dynamic>{}
          : <String, dynamic>{'refreshToken': refreshToken},
    );
  }
}
