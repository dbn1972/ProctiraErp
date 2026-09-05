import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/auth/auth_bloc.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // Use the in-memory channel mocks for secure storage so we can drive the
  // bloc without touching the platform.
  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  test('AuthBloc bootstraps to unauthenticated when no tokens are stored',
      () async {
    final SecureStorage storage = SecureStorage(const FlutterSecureStorage());
    final AuthBloc bloc = AuthBloc(secureStorage: storage);

    bloc.add(const AuthBootstrapRequested());
    await expectLater(
      bloc.stream,
      emitsInOrder(<dynamic>[
        predicate<AuthState>((AuthState s) => s.status == AuthStatus.loading),
        predicate<AuthState>(
          (AuthState s) => s.status == AuthStatus.unauthenticated,
        ),
      ]),
    );

    await bloc.close();
  });

  test('AuthBloc transitions to authenticated after login', () async {
    final SecureStorage storage = SecureStorage(const FlutterSecureStorage());
    final AuthBloc bloc = AuthBloc(secureStorage: storage);

    bloc.add(const AuthLoggedIn(
      userId: 'u1',
      accessToken: 'a',
      refreshToken: 'r',
    ));

    await expectLater(
      bloc.stream,
      emits(predicate<AuthState>(
        (AuthState s) =>
            s.status == AuthStatus.authenticated &&
            s.userId == 'u1' &&
            s.accessToken == 'a',
      )),
    );

    expect(await storage.readAccessToken(), 'a');
    expect(await storage.readRefreshToken(), 'r');

    await bloc.close();
  });
}
