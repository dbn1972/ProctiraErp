/// Token pair + user summary returned by `POST /api/v1/auth/login`.
class AuthLoginResult {
  const AuthLoginResult({
    required this.userId,
    required this.accessToken,
    required this.refreshToken,
    this.email,
    this.displayName,
    this.expiresIn,
  });

  final String userId;
  final String accessToken;
  final String refreshToken;
  final String? email;
  final String? displayName;
  final int? expiresIn;

  factory AuthLoginResult.fromJson(Map<String, dynamic> json) {
    final Object? tokensRaw = json['tokens'];
    final Object? userRaw = json['user'];
    if (tokensRaw is! Map<String, dynamic>) {
      throw const FormatException('Login response missing tokens');
    }
    if (userRaw is! Map<String, dynamic>) {
      throw const FormatException('Login response missing user');
    }
    final String? access = tokensRaw['accessToken'] as String?;
    final String? refresh = tokensRaw['refreshToken'] as String?;
    final String? userId = userRaw['userId'] as String?;
    if (access == null || access.isEmpty) {
      throw const FormatException('Login response missing accessToken');
    }
    if (refresh == null || refresh.isEmpty) {
      throw const FormatException('Login response missing refreshToken');
    }
    if (userId == null || userId.isEmpty) {
      throw const FormatException('Login response missing userId');
    }
    return AuthLoginResult(
      userId: userId,
      accessToken: access,
      refreshToken: refresh,
      email: userRaw['email'] as String?,
      displayName: userRaw['displayName'] as String?,
      expiresIn: tokensRaw['expiresIn'] as int?,
    );
  }
}

/// Token pair returned by `POST /api/v1/auth/refresh`.
class AuthTokenPair {
  const AuthTokenPair({
    required this.accessToken,
    required this.refreshToken,
    this.expiresIn,
  });

  final String accessToken;
  final String refreshToken;
  final int? expiresIn;

  factory AuthTokenPair.fromJson(Map<String, dynamic> json) {
    final Object? tokensRaw = json['tokens'] ?? json;
    if (tokensRaw is! Map<String, dynamic>) {
      throw const FormatException('Refresh response missing tokens');
    }
    final String? access = tokensRaw['accessToken'] as String?;
    final String? refresh = tokensRaw['refreshToken'] as String?;
    if (access == null || access.isEmpty || refresh == null || refresh.isEmpty) {
      throw const FormatException('Refresh response missing token pair');
    }
    return AuthTokenPair(
      accessToken: access,
      refreshToken: refresh,
      expiresIn: tokensRaw['expiresIn'] as int?,
    );
  }
}
