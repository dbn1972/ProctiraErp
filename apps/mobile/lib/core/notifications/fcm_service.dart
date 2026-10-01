import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:proctira_api_client/proctira_api_client.dart';

import '../../features/notifications/data/notification_repository.dart';
import 'local_notifications.dart';
import 'notification_router.dart';

/// Type of incoming push notification event used by [FcmService.deepLinks].
enum FcmDeepLinkSource { messageOpened, initialMessage }

/// Convenience pair emitted by [FcmService.deepLinks] when a notification is
/// tapped while the app is running or launched via a notification tap.
class FcmDeepLink {
  const FcmDeepLink({required this.route, required this.source, this.payload});
  final String route;
  final FcmDeepLinkSource source;
  final Map<String, dynamic>? payload;
}

/// Top-level background handler. Required by `firebase_messaging` to be a
/// top-level / static function so it can be invoked from a background isolate.
@pragma('vm:entry-point')
Future<void> openemisFcmBackgroundHandler(RemoteMessage message) async {
  // Background messages are persisted to the local cache when the app is
  // resumed (see [FcmService.start]); for now we rely on the system tray to
  // surface the alert without doing extra work in this isolate.
  await Firebase.initializeApp();
}

/// Coordinator for Firebase Cloud Messaging.
///
/// Responsibilities:
/// - Initialise [Firebase] (wrapped in try/catch so the app boots even when
///   no `google-services.json` / `GoogleService-Info.plist` is present).
/// - Request notification permission from the OS.
/// - Retrieve the FCM token and register it with the backend via
///   [NotificationDeviceApi].
/// - Forward incoming messages to the local cache (so they show up in the
///   inbox) and to [LocalNotifications] when the app is in the foreground.
/// - Expose a stream of deep-link routes so the router layer can navigate
///   when the user taps a notification.
class FcmService {
  FcmService({
    required NotificationDeviceApi deviceApi,
    required NotificationRepository repository,
    required NotificationRouter router,
    required LocalNotifications localNotifications,
    FirebaseMessaging? messaging,
    Future<void> Function(FirebaseOptions? options)?
        firebaseInitialiser,
    FirebaseOptions? firebaseOptions,
  })  : _deviceApi = deviceApi,
        _repository = repository,
        _router = router,
        _localNotifications = localNotifications,
        _messagingOverride = messaging,
        _firebaseInitialiser = firebaseInitialiser,
        _firebaseOptions = firebaseOptions;

  final NotificationDeviceApi _deviceApi;
  final NotificationRepository _repository;
  final NotificationRouter _router;
  final LocalNotifications _localNotifications;
  final FirebaseMessaging? _messagingOverride;
  final Future<void> Function(FirebaseOptions? options)? _firebaseInitialiser;
  final FirebaseOptions? _firebaseOptions;

  bool _started = false;
  String? _token;

  /// Last retrieved FCM token (null if Firebase is not configured or
  /// permission was denied).
  String? get token => _token;

  /// Initialise Firebase + register the device. Safe to call multiple times.
  ///
  /// Returns `true` when Firebase was initialised and the device was
  /// registered with the backend; returns `false` when Firebase is not
  /// configured (e.g. missing platform config files in dev). The app should
  /// continue to function in either case.
  Future<bool> start() async {
    if (_started) return true;
    try {
      if (_firebaseInitialiser != null) {
        await _firebaseInitialiser(_firebaseOptions);
      } else {
        await Firebase.initializeApp(options: _firebaseOptions);
      }
    } catch (error, stack) {
      debugPrint('Firebase.initializeApp skipped: $error');
      debugPrintStack(stackTrace: stack);
      return false;
    }

    await _localNotifications.init(onTap: _onLocalNotificationTap);

    final FirebaseMessaging messaging =
        _messagingOverride ?? FirebaseMessaging.instance;

    try {
      // iOS / web request a permission prompt; Android <13 no-ops.
      await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );

      // Foreground display style on iOS so banners / sounds appear.
      await messaging.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );

      _token = await messaging.getToken();
      if (_token != null && _token!.isNotEmpty) {
        await _registerDevice(_token!);
      }
      messaging.onTokenRefresh.listen((String token) async {
        _token = token;
        await _registerDevice(token);
      });
    } catch (error) {
      // Token retrieval can fail on simulators / when APNs is unavailable.
      // Continue without push but still subscribe to in-app messages.
      debugPrint('FCM token registration skipped: $error');
    }

    FirebaseMessaging.onMessage.listen(_onForegroundMessage);
    FirebaseMessaging.onMessageOpenedApp.listen(_onMessageOpenedApp);
    FirebaseMessaging.onBackgroundMessage(openemisFcmBackgroundHandler);

    // If the app was launched by tapping a notification, surface that as a
    // deep-link event so the router can navigate after first frame.
    final RemoteMessage? launchMessage = await messaging.getInitialMessage();
    if (launchMessage != null) {
      await _persist(launchMessage);
      _emitDeepLink(launchMessage, FcmDeepLinkSource.initialMessage);
    }

    _started = true;
    return true;
  }

  /// Stream of routes the router should navigate to when a notification is
  /// tapped. Backed by a broadcast controller so multiple listeners (e.g.
  /// router + analytics) can subscribe.
  Stream<FcmDeepLink> get deepLinks => _deepLinkController.stream;

  final StreamController<FcmDeepLink> _deepLinkController =
      StreamController<FcmDeepLink>.broadcast();

  Future<void> _registerDevice(String token) async {
    try {
      final String platform = Platform.isIOS
          ? 'ios'
          : Platform.isAndroid
              ? 'android'
              : 'other';
      await _deviceApi.registerDevice(
        deviceToken: token,
        platform: platform,
        deviceId: token, // until a stable installation id is wired in
      );
    } catch (error) {
      debugPrint('Device registration failed: $error');
    }
  }

  Future<void> _onForegroundMessage(RemoteMessage message) async {
    await _persist(message);
    final RemoteNotification? notification = message.notification;
    if (notification != null) {
      await _localNotifications.show(
        id: message.messageId.hashCode,
        title: notification.title ?? 'ProctiraERP',
        body: notification.body ?? '',
        payload: message.data,
      );
    }
  }

  Future<void> _onMessageOpenedApp(RemoteMessage message) async {
    await _persist(message);
    _emitDeepLink(message, FcmDeepLinkSource.messageOpened);
  }

  Future<void> _persist(RemoteMessage message) async {
    try {
      await _repository.upsertFromRemote(message);
    } catch (error) {
      debugPrint('Notification persistence failed: $error');
    }
  }

  void _emitDeepLink(RemoteMessage message, FcmDeepLinkSource source) {
    final String route = _router.routeFor(_normaliseData(message.data));
    _deepLinkController.add(
      FcmDeepLink(
        route: route,
        source: source,
        payload: _normaliseData(message.data),
      ),
    );
  }

  void _onLocalNotificationTap(String? payload) {
    if (payload == null || payload.isEmpty) return;
    final Map<String, dynamic>? decoded = _tryDecodePayload(payload);
    final String route = _router.routeFor(decoded);
    _deepLinkController.add(
      FcmDeepLink(
        route: route,
        source: FcmDeepLinkSource.messageOpened,
        payload: decoded,
      ),
    );
  }

  Map<String, dynamic> _normaliseData(Map<String, dynamic> raw) {
    return raw.map((String k, dynamic v) => MapEntry<String, dynamic>(k, v));
  }

  Map<String, dynamic>? _tryDecodePayload(String raw) {
    try {
      final dynamic decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) return decoded;
    } catch (_) {/* ignore */}
    return null;
  }
}
