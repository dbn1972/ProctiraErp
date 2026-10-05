import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:proctira_mobile/core/auth/auth_bloc.dart';
import 'package:proctira_mobile/core/notifications/fcm_service.dart';
import 'package:proctira_mobile/core/notifications/local_notifications.dart';
import 'package:proctira_mobile/core/notifications/notification_router.dart';
import 'package:proctira_mobile/core/notifications/push_device_lifecycle.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/features/notifications/data/notification_repository.dart';

class _RecordingDeviceApi implements NotificationDeviceApi {
  final List<String> calls = <String>[];
  int failuresBeforeSuccess = 0;

  @override
  Future<void> registerDevice({
    required String deviceToken,
    required String platform,
    required String deviceId,
  }) async {
    if (failuresBeforeSuccess > 0) {
      failuresBeforeSuccess--;
      throw StateError('offline');
    }
    calls.add('register:$deviceId:$deviceToken');
  }

  @override
  Future<void> unregisterDevice({required String deviceId}) async {
    calls.add('unregister:$deviceId');
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeMessaging implements FirebaseMessaging {
  int deleted = 0;
  int tokenRequests = 0;
  String? nextToken;

  @override
  Future<void> deleteToken() async => deleted++;

  @override
  Future<String?> getToken({
    String? vapidKey,
    String? serviceWorkerScriptPath,
  }) async {
    tokenRequests++;
    return nextToken;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Any implements NotificationRepository, LocalNotifications {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _RecordingPush implements PushDeviceLifecycle {
  _RecordingPush(this.storage);
  final SecureStorage storage;
  final List<String> calls = <String>[];

  @override
  Future<void> onAuthenticated() async => calls.add('registered');

  @override
  Future<void> onLoggingOut() async {
    // Must run while the session still exists (before purge).
    final String? token = await storage.readAccessToken();
    calls.add('unregistered:token=${token ?? 'none'}');
  }
}

/// PRC-M033: push registration follows the auth session.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => FlutterSecureStorage.setMockInitialValues(<String, String>{}));

  FcmService build(_RecordingDeviceApi api, _FakeMessaging messaging) =>
      FcmService(
        deviceApi: api,
        repository: _Any(),
        router: const NotificationRouter(),
        localNotifications: _Any(),
        messaging: messaging,
        installationId: () async => 'install-1',
        registrationRetryBase: Duration.zero,
      );

  test('login registers with installation id; logout unregisters', () async {
    final _RecordingDeviceApi api = _RecordingDeviceApi();
    final _FakeMessaging messaging = _FakeMessaging();
    final FcmService fcm = build(api, messaging)..debugToken = 'tok-1';

    await fcm.onAuthenticated();
    expect(api.calls, <String>['register:install-1:tok-1']);

    await fcm.onLoggingOut();
    expect(api.calls.last, 'unregister:install-1');
    expect(messaging.deleted, 1);
    expect(fcm.token, isNull);
  });

  test('login → logout → login in one process re-registers', () async {
    final _RecordingDeviceApi api = _RecordingDeviceApi();
    final _FakeMessaging messaging = _FakeMessaging();
    final FcmService fcm = build(api, messaging)..debugToken = 'tok-1';

    await fcm.onAuthenticated();
    await fcm.onLoggingOut();
    expect(fcm.token, isNull);

    // FCM issues a new token only on request after deleteToken.
    messaging.nextToken = 'tok-2';
    await fcm.onAuthenticated();

    expect(messaging.tokenRequests, 1);
    expect(fcm.token, 'tok-2');
    expect(api.calls, <String>[
      'register:install-1:tok-1',
      'unregister:install-1',
      'register:install-1:tok-2',
    ]);
  });

  test('registration retries transient failures', () async {
    final _RecordingDeviceApi api = _RecordingDeviceApi()
      ..failuresBeforeSuccess = 2;
    final FcmService fcm = build(api, _FakeMessaging())..debugToken = 'tok';
    await fcm.onAuthenticated();
    expect(api.calls, <String>['register:install-1:tok']);
  });

  test('no registration before login', () async {
    final _RecordingDeviceApi api = _RecordingDeviceApi();
    final FcmService fcm = build(api, _FakeMessaging())..debugToken = 'tok';
    await fcm.onLoggingOut();
    expect(api.calls, isEmpty);
  });

  test('AuthBloc: login registers, logout unregisters before purge', () async {
    final SecureStorage storage = SecureStorage(const FlutterSecureStorage());
    final _RecordingPush push = _RecordingPush(storage);
    final AuthBloc bloc = AuthBloc(secureStorage: storage, push: push);

    bloc.add(
      const AuthLoggedIn(userId: 'u1', accessToken: 'a', refreshToken: 'r'),
    );
    await bloc.stream.firstWhere((AuthState s) => s.isAuthenticated);
    await pumpEventQueue();
    expect(push.calls, <String>['registered']);

    bloc.add(const AuthLogoutRequested());
    await bloc.stream.firstWhere(
      (AuthState s) => s.status == AuthStatus.unauthenticated,
    );
    expect(push.calls.last, 'unregistered:token=a');
    expect(await storage.readAccessToken(), isNull);
    await bloc.close();
  });
}
