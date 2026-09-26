import 'package:flutter/material.dart';

import '../storage/secure_storage.dart';

/// Holds the current tenant identifier for the running session.
///
/// The tenant id is read from secure storage on startup and is added as the
/// `X-Tenant-ID` header on outgoing API requests (see DI configuration).
/// When the value is missing the app should redirect the user into the tenant
/// selection flow.
class TenantProvider extends ChangeNotifier {
  TenantProvider(this._storage);

  final SecureStorage _storage;

  String? _tenantId;
  String? _displayName;
  Color? _primaryColor;
  Color? _secondaryColor;
  Locale? _locale;
  ThemeMode _themeMode = ThemeMode.system;
  bool _bootstrapped = false;

  String? get tenantId => _tenantId;
  String? get displayName => _displayName;
  Color? get primaryColor => _primaryColor;
  Color? get secondaryColor => _secondaryColor;
  Locale? get locale => _locale;
  ThemeMode get themeMode => _themeMode;
  bool get hasTenant => _tenantId != null && _tenantId!.isNotEmpty;
  bool get isBootstrapped => _bootstrapped;

  Future<void> bootstrap() async {
    _tenantId = await _storage.readTenantId();
    _displayName = await _storage.readTenantName();
    final String? localeCode = await _storage.readLocaleCode();
    if (localeCode != null && localeCode.isNotEmpty) {
      _locale = Locale(localeCode);
    }
    _themeMode = _parseThemeMode(await _storage.readThemeMode());
    _bootstrapped = true;
    notifyListeners();
  }

  Future<void> setTenant({
    required String tenantId,
    String? displayName,
    Color? primaryColor,
    Color? secondaryColor,
  }) async {
    await _storage.writeTenant(tenantId: tenantId, displayName: displayName);
    _tenantId = tenantId;
    _displayName = displayName ?? _displayName;
    _primaryColor = primaryColor;
    _secondaryColor = secondaryColor;
    notifyListeners();
  }

  /// Update the app locale preference and keep it on this device.
  ///
  /// A null locale follows the device language.
  Future<void> setLocale(Locale? newLocale) async {
    _locale = newLocale;
    if (newLocale == null) {
      await _storage.clearLocaleCode();
    } else {
      await _storage.writeLocaleCode(newLocale.languageCode);
    }
    notifyListeners();
  }

  /// Update the theme mode and keep it on this device.
  Future<void> setThemeMode(ThemeMode mode) async {
    _themeMode = mode;
    await _storage.writeThemeMode(mode.name);
    notifyListeners();
  }

  ThemeMode _parseThemeMode(String? raw) {
    switch (raw) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      default:
        return ThemeMode.system;
    }
  }

  Future<void> clear() async {
    await _storage.clearTenant();
    _tenantId = null;
    _displayName = null;
    _primaryColor = null;
    _secondaryColor = null;
    _locale = null;
    notifyListeners();
  }
}
