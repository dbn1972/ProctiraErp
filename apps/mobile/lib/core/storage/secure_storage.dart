import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Thin wrapper over [FlutterSecureStorage] exposing typed accessors for the
/// values ProctiraERP persists across app launches (tokens, tenant id, biometric
/// opt-in flag).
class SecureStorage {
  SecureStorage(this._storage);

  static const String accessTokenKey = 'auth.access_token';
  static const String refreshTokenKey = 'auth.refresh_token';
  static const String tenantIdKey = 'tenant.id';
  static const String tenantNameKey = 'tenant.display_name';
  static const String biometricEnabledKey = 'auth.biometric_enabled';

  final FlutterSecureStorage _storage;

  Future<String?> readAccessToken() => _storage.read(key: accessTokenKey);
  Future<String?> readRefreshToken() => _storage.read(key: refreshTokenKey);

  Future<void> writeTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await _storage.write(key: accessTokenKey, value: accessToken);
    await _storage.write(key: refreshTokenKey, value: refreshToken);
  }

  Future<void> clearTokens() async {
    await _storage.delete(key: accessTokenKey);
    await _storage.delete(key: refreshTokenKey);
  }

  /// Drop only the access token so a biometric unlock can still refresh.
  Future<void> clearAccessToken() async {
    await _storage.delete(key: accessTokenKey);
  }

  Future<String?> readTenantId() => _storage.read(key: tenantIdKey);

  Future<String?> readTenantName() => _storage.read(key: tenantNameKey);

  Future<void> writeTenant({required String tenantId, String? displayName}) async {
    await _storage.write(key: tenantIdKey, value: tenantId);
    if (displayName != null) {
      await _storage.write(key: tenantNameKey, value: displayName);
    }
  }

  Future<void> clearTenant() async {
    await _storage.delete(key: tenantIdKey);
    await _storage.delete(key: tenantNameKey);
  }

  Future<bool> readBiometricEnabled() async {
    final String? raw = await _storage.read(key: biometricEnabledKey);
    return raw == 'true';
  }

  Future<void> writeBiometricEnabled(bool enabled) async {
    await _storage.write(key: biometricEnabledKey, value: enabled.toString());
  }
}
