import 'package:local_auth/local_auth.dart';

import '../storage/secure_storage.dart';

/// Wraps [LocalAuthentication] to support fingerprint and face unlock.
///
/// Stores a per-device opt-in flag in [SecureStorage]; the actual tokens are
/// re-issued by the backend after a successful biometric check.
class BiometricService {
  BiometricService(this._auth, this._storage);

  final LocalAuthentication _auth;
  final SecureStorage _storage;

  /// Whether the device has biometric hardware (and the OS supports it).
  Future<bool> isAvailable() async {
    try {
      final bool supported = await _auth.isDeviceSupported();
      if (!supported) {
        return false;
      }
      final bool canCheck = await _auth.canCheckBiometrics;
      return canCheck;
    } on Exception {
      return false;
    }
  }

  /// Returns the biometric types enrolled on this device (fingerprint, face,
  /// strong, weak, iris).
  Future<List<BiometricType>> enrolledBiometrics() async {
    try {
      return await _auth.getAvailableBiometrics();
    } on Exception {
      return const <BiometricType>[];
    }
  }

  /// Whether the user opted into biometric login.
  Future<bool> isEnabled() => _storage.readBiometricEnabled();

  /// Persist the user's preference. The caller is responsible for re-issuing
  /// tokens via the backend after a successful biometric authentication.
  Future<void> setEnabled(bool enabled) => _storage.writeBiometricEnabled(enabled);

  /// Prompt the user for biometric authentication. Returns true if the
  /// platform reported a successful match.
  Future<bool> authenticate({
    String reason = 'Sign in to ProctiraERP',
  }) async {
    try {
      return await _auth.authenticate(
        localizedReason: reason,
        options: const AuthenticationOptions(
          biometricOnly: true,
          stickyAuth: true,
        ),
      );
    } on Exception {
      return false;
    }
  }
}
