import 'package:dio/dio.dart';

/// Successful authentication session returned by the gateway.
class AuthSession {
  const AuthSession({
    required this.userId,
    required this.accessToken,
    required this.refreshToken,
    this.displayName,
  });

  final String userId;
  final String accessToken;
  final String refreshToken;
  final String? displayName;
}

/// Thin Dio wrapper around gateway auth endpoints.
///
/// - Password login: `POST /api/v1/auth/login` (legacy wrapped tokens),
///   falling back to `POST /api/v1/auth/password` (Keycloak flat tokens).
/// - Session refresh: `POST /api/v1/auth/refresh` (used after biometric unlock).
class AuthRepository {
  AuthRepository({required Dio dio}) : _dio = dio;

  final Dio _dio;

  /// Authenticate with username/email + password.
  Future<AuthSession> login({
    required String username,
    required String password,
  }) async {
    final Map<String, dynamic> body = <String, dynamic>{
      'username': username,
      'password': password,
    };

    try {
      final Response<dynamic> response = await _dio.post(
        '/api/v1/auth/login',
        data: body,
      );
      return _parseSession(response.data, fallbackUserId: username);
    } on DioException catch (error) {
      if (_shouldTryPasswordGrant(error)) {
        final Response<dynamic> response = await _dio.post(
          '/api/v1/auth/password',
          data: body,
        );
        return _parseSession(response.data, fallbackUserId: username);
      }
      throw AuthException.fromDio(error);
    }
  }

  /// Exchange a refresh token for a new access/refresh pair.
  Future<AuthSession> refresh(String refreshToken) async {
    try {
      final Response<dynamic> response = await _dio.post(
        '/api/v1/auth/refresh',
        data: <String, dynamic>{'refreshToken': refreshToken},
      );
      return _parseSession(response.data, fallbackUserId: 'user');
    } on DioException catch (error) {
      throw AuthException.fromDio(error);
    }
  }

  bool _shouldTryPasswordGrant(DioException error) {
    final int? status = error.response?.statusCode;
    return status == 404 ||
        status == 405 ||
        status == 501 ||
        status == 302 ||
        status == 303;
  }

  AuthSession _parseSession(
    dynamic raw, {
    required String fallbackUserId,
  }) {
    if (raw is! Map) {
      throw const AuthException('Unexpected auth response');
    }
    final Map<String, dynamic> data = Map<String, dynamic>.from(raw);

    // Legacy: { tokens: { accessToken, refreshToken }, user: { userId, ... } }
    final Object? tokensObj = data['tokens'];
    if (tokensObj is Map) {
      final Map<String, dynamic> tokens = Map<String, dynamic>.from(tokensObj);
      final Object? userObj = data['user'];
      final Map<String, dynamic>? user = userObj is Map
          ? Map<String, dynamic>.from(userObj)
          : null;
      final String? access = tokens['accessToken'] as String?;
      final String? refresh = tokens['refreshToken'] as String?;
      if (access == null ||
          access.isEmpty ||
          refresh == null ||
          refresh.isEmpty) {
        throw const AuthException('Auth response missing tokens');
      }
      return AuthSession(
        userId: (user?['userId'] as String?) ??
            (user?['email'] as String?) ??
            fallbackUserId,
        accessToken: access,
        refreshToken: refresh,
        displayName: user?['displayName'] as String?,
      );
    }

    // Keycloak / flat: { accessToken, refreshToken, user? }
    final String? access = data['accessToken'] as String?;
    final String? refresh = data['refreshToken'] as String?;
    if (access == null || access.isEmpty) {
      throw AuthException(
        (data['message'] as String?) ?? 'Auth response missing access token',
      );
    }
    if (refresh == null || refresh.isEmpty) {
      throw const AuthException('Auth response missing refresh token');
    }
    final Object? userObj = data['user'];
    final Map<String, dynamic>? user =
        userObj is Map ? Map<String, dynamic>.from(userObj) : null;
    return AuthSession(
      userId: (user?['userId'] as String?) ??
          (user?['id'] as String?) ??
          (user?['email'] as String?) ??
          fallbackUserId,
      accessToken: access,
      refreshToken: refresh,
      displayName: user?['displayName'] as String?,
    );
  }
}

/// Domain error for auth failures (credentials, lockout, network).
class AuthException implements Exception {
  const AuthException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  factory AuthException.fromDio(DioException error) {
    final Object? data = error.response?.data;
    String message = 'Sign-in failed. Please try again.';
    if (data is Map && data['message'] is String) {
      message = data['message'] as String;
    } else if (error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.connectionError) {
      message = 'Unable to reach the authentication service.';
    }
    return AuthException(message, statusCode: error.response?.statusCode);
  }

  @override
  String toString() => message;
}
