import 'dart:ui';

import 'package:flutter/foundation.dart';

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
  bool _bootstrapped = false;

  String? get tenantId => _tenantId;
  String? get displayName => _displayName;
  Color? get primaryColor => _primaryColor;
  Color? get secondaryColor => _secondaryColor;
  Locale? get locale => _locale;
  bool get hasTenant => _tenantId != null && _tenantId!.isNotEmpty;
  bool get isBootstrapped => _bootstrapped;

  Future<void> bootstrap() async {
    _tenantId = await _storage.readTenantId();
    _displayName = await _storage.readTenantName();
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

  /// Update the app locale preference.
  void setLocale(Locale? newLocale) {
    _locale = newLocale;
    notifyListeners();
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
