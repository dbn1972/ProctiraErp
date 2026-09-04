import 'package:dio/dio.dart';

/// Successful authentication session returned by the gateway.
class AuthSession {
  const AuthSession({
    required this.userId,
    required this.accessToken,
    required this.refreshToken,
    this.displayName,
    this.email,
    this.role,
  });

  final String userId;
  final String accessToken;
  final String refreshToken;
  final String? displayName;
  final String? email;
  final String? role;
}

/// Current-user profile from `GET /api/v1/auth/me`.
class AuthUserProfile {
  const AuthUserProfile({
    required this.userId,
    this.displayName,
    this.email,
    this.phone,
    this.role,
    this.tenantId,
  });

  final String userId;
  final String? displayName;
  final String? email;
  final String? phone;
  final String? role;
  final String? tenantId;
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

  /// Load the authenticated user from `GET /api/v1/auth/me`.
  Future<AuthUserProfile> fetchCurrentUser() async {
    try {
      final Response<dynamic> response = await _dio.get('/api/v1/auth/me');
      return _parseUserProfile(response.data);
    } on DioException catch (error) {
      throw AuthException.fromDio(error);
    }
  }

  AuthUserProfile _parseUserProfile(dynamic raw) {
    if (raw is! Map) {
      throw const AuthException('Unexpected /auth/me response');
    }
    final Map<String, dynamic> data = Map<String, dynamic>.from(raw);

    // Legacy auth: flat { userId, email, displayName, roles, ... }
    if (data['userId'] is String || data['email'] is String) {
      return AuthUserProfile(
        userId: (data['userId'] as String?) ??
            (data['email'] as String?) ??
            'user',
        displayName: data['displayName'] as String?,
        email: data['email'] as String?,
        phone: data['phone'] as String?,
        role: _firstRole(data['roles']),
        tenantId: data['tenantId'] as String?,
      );
    }

    // Keycloak: { provider, realm, user: { sub, email, ... } }
    final Object? userObj = data['user'];
    if (userObj is Map) {
      final Map<String, dynamic> user = Map<String, dynamic>.from(userObj);
      return AuthUserProfile(
        userId: (user['sub'] as String?) ??
            (user['userId'] as String?) ??
            (user['email'] as String?) ??
            (user['preferred_username'] as String?) ??
            'user',
        displayName: (user['displayName'] as String?) ??
            (user['name'] as String?) ??
            (user['preferred_username'] as String?),
        email: user['email'] as String?,
        phone: (user['phone'] as String?) ?? (user['phone_number'] as String?),
        role: _firstRole(user['roles']) ??
            _firstRole(
              (user['realm_access'] is Map)
                  ? (user['realm_access'] as Map)['roles']
                  : null,
            ),
        tenantId: (user['tenantId'] as String?) ?? (user['tid'] as String?),
      );
    }

    throw const AuthException('Unexpected /auth/me response');
  }

  String? _firstRole(Object? roles) {
    if (roles is List && roles.isNotEmpty) {
      final Object first = roles.first;
      if (first is String) return first;
      if (first is Map) {
        return (first['roleId'] as String?) ??
            (first['name'] as String?) ??
            (first['role'] as String?);
      }
    }
    if (roles is String && roles.isNotEmpty) return roles;
    return null;
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
        email: user?['email'] as String?,
        role: _firstRole(user?['roles']),
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
      displayName: (user?['displayName'] as String?) ??
          (user?['name'] as String?),
      email: user?['email'] as String?,
      role: _firstRole(user?['roles']),
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
