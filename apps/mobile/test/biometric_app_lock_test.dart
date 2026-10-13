import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/auth/auth_bloc.dart';
import 'package:proctira_mobile/core/auth/biometric_service.dart';
import 'package:proctira_mobile/core/router/app_router.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Fake biometric gate so tests do not touch platform channels.
class _FakeBiometric implements BiometricGate {
  _FakeBiometric({
    this.available = true,
    this.enabled = true,
    this.authResult = true,
  });

  bool available;
  bool enabled;
  bool authResult;
  int authCalls = 0;

  @override
  Future<bool> isAvailable() async => available;

  @override
  Future<bool> isEnabled() async => enabled;

  @override
  Future<bool> authenticate({String reason = ''}) async {
    authCalls += 1;
    return authResult;
  }
}

/// In-memory secure storage seeded with a restored session.
SecureStorage _storageWithSession() {
  FlutterSecureStorage.setMockInitialValues(<String, String>{
    'auth.access_token': 'header.${base64Payload()}.sig',
    'auth.refresh_token': 'refresh-token',
    'auth.user_id': 'user-1',
  });
  return SecureStorage(const FlutterSecureStorage());
}

String base64Payload() {
  // minimal JWT body with a staff role so routing is deterministic
  return 'eyJyb2xlcyI6WyJzdGFmZiJdfQ';
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('PRC-M469 biometric app-lock', () {
    test('restored session starts locked when biometric enabled+available',
        () async {
      final bio = _FakeBiometric(enabled: true, available: true);
      final bloc = AuthBloc(secureStorage: _storageWithSession(), biometric: bio);
      bloc.add(const AuthBootstrapRequested());
      await bloc.stream.firstWhere((s) => s.isResolved || s.isLocked);
      // allow the async bootstrap to settle
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(bloc.state.status, AuthStatus.locked);
      await bloc.close();
    });

    test('unlock event authenticates on success', () async {
      final bio = _FakeBiometric(enabled: true, available: true, authResult: true);
      final bloc = AuthBloc(secureStorage: _storageWithSession(), biometric: bio);
      bloc.add(const AuthBootstrapRequested());
      await Future<void>.delayed(const Duration(milliseconds: 10));
      expect(bloc.state.status, AuthStatus.locked);
      bloc.add(const AuthBiometricUnlockRequested());
      await bloc.stream.firstWhere((s) => s.isAuthenticated);
      expect(bloc.state.status, AuthStatus.authenticated);
      expect(bio.authCalls, 1);
      await bloc.close();
    });

    test('session is authenticated directly when biometric disabled', () async {
      final bio = _FakeBiometric(enabled: false);
      final bloc = AuthBloc(secureStorage: _storageWithSession(), biometric: bio);
      bloc.add(const AuthBootstrapRequested());
      await bloc.stream.firstWhere((s) => s.isAuthenticated);
      expect(bloc.state.status, AuthStatus.authenticated);
      await bloc.close();
    });

    test('locked session redirects every route to /lock', () {
      const locked = AuthState.locked();
      expect(
        AppRouter.resolveRedirect(
          auth: locked,
          hasTenant: true,
          location: '/students',
          uri: Uri.parse('/students'),
        ),
        '/lock',
      );
      expect(
        AppRouter.resolveRedirect(
          auth: locked,
          hasTenant: true,
          location: '/lock',
          uri: Uri.parse('/lock'),
        ),
        isNull,
      );
    });
  });
}
