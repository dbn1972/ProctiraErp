import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'cache_crypto.dart';

/// Thin wrapper over [FlutterSecureStorage] exposing typed accessors for the
/// values OpenEMIS persists across app launches (tokens, tenant id, biometric
/// opt-in flag, offline-cache master key).
class SecureStorage {
  SecureStorage(this._storage);

  static const String accessTokenKey = 'auth.access_token';
  static const String refreshTokenKey = 'auth.refresh_token';
  static const String userIdKey = 'auth.user_id';
  static const String userEmailKey = 'auth.user_email';
  static const String userDisplayNameKey = 'auth.user_display_name';
  static const String tenantIdKey = 'tenant.id';
  static const String tenantNameKey = 'tenant.display_name';
  static const String biometricEnabledKey = 'auth.biometric_enabled';
  static const String cacheMasterKeyKey = 'crypto.cache_master_key';

  final FlutterSecureStorage _storage;

  /// Returns the AES-256 key used to seal child PII in SQLite, creating one
  /// on first use. The key never leaves encrypted platform storage.
  Future<Uint8List> getOrCreateCacheMasterKey() async {
    final String? existing = await _storage.read(key: cacheMasterKeyKey);
    if (existing != null && existing.isNotEmpty) {
      return Uint8List.fromList(base64Decode(existing));
    }
    final Uint8List fresh = generateCacheMasterKey();
    await _storage.write(
      key: cacheMasterKeyKey,
      value: base64Encode(fresh),
    );
    return fresh;
  }

  Future<String?> readAccessToken() => _storage.read(key: accessTokenKey);
  Future<String?> readRefreshToken() => _storage.read(key: refreshTokenKey);

  Future<void> writeTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await _storage.write(key: accessTokenKey, value: accessToken);
    await _storage.write(key: refreshTokenKey, value: refreshToken);
  }

  Future<String?> readUserId() => _storage.read(key: userIdKey);

  Future<String?> readUserEmail() => _storage.read(key: userEmailKey);

  Future<String?> readUserDisplayName() =>
      _storage.read(key: userDisplayNameKey);

  Future<void> writeUserProfile({
    required String userId,
    String? email,
    String? displayName,
  }) async {
    await _storage.write(key: userIdKey, value: userId);
    if (email != null) {
      await _storage.write(key: userEmailKey, value: email);
    }
    if (displayName != null) {
      await _storage.write(key: userDisplayNameKey, value: displayName);
    }
  }

  Future<void> clearTokens() async {
    await _storage.delete(key: accessTokenKey);
    await _storage.delete(key: refreshTokenKey);
    await _storage.delete(key: userIdKey);
    await _storage.delete(key: userEmailKey);
    await _storage.delete(key: userDisplayNameKey);
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
