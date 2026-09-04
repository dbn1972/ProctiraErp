import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Thin wrapper around [FlutterLocalNotificationsPlugin] used to display
/// foreground push notifications (iOS does not auto-show notifications when
/// the app is in the foreground, so we re-render them locally).
///
/// `init` is wrapped in a try/catch so the app boots even when the underlying
/// plugin fails to initialise (typical in dev / test environments without a
/// configured channel id).
class LocalNotifications {
  LocalNotifications({FlutterLocalNotificationsPlugin? plugin})
      : _plugin = plugin ?? FlutterLocalNotificationsPlugin();

  final FlutterLocalNotificationsPlugin _plugin;
  bool _initialised = false;

  /// Default Android channel used for transactional notifications.
  static const AndroidNotificationChannel defaultChannel =
      AndroidNotificationChannel(
    'openemis_default',
    'ProctiraERP Notifications',
    description: 'Real-time alerts from the ProctiraERP platform.',
    importance: Importance.high,
  );

  Future<void> init({void Function(String? payload)? onTap}) async {
    if (_initialised) return;
    try {
      const AndroidInitializationSettings androidSettings =
          AndroidInitializationSettings('@mipmap/ic_launcher');
      const DarwinInitializationSettings iosSettings =
          DarwinInitializationSettings(
        requestAlertPermission: false,
        requestBadgePermission: false,
        requestSoundPermission: false,
      );
      const InitializationSettings settings = InitializationSettings(
        android: androidSettings,
        iOS: iosSettings,
        macOS: iosSettings,
      );
      await _plugin.initialize(
        settings,
        onDidReceiveNotificationResponse: (NotificationResponse response) {
          if (onTap != null) onTap(response.payload);
        },
      );
      // Register the Android channel so high-importance notifications are
      // surfaced as banners even on Android 13+.
      final AndroidFlutterLocalNotificationsPlugin? android =
          _plugin.resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>();
      await android?.createNotificationChannel(defaultChannel);
      _initialised = true;
    } catch (error, stack) {
      debugPrint('LocalNotifications.init failed: $error');
      debugPrintStack(stackTrace: stack);
    }
  }

  /// Display a notification immediately. The [payload] map is JSON-encoded
  /// and round-trips through the plugin so taps can deep-link reliably.
  Future<void> show({
    required int id,
    required String title,
    required String body,
    Map<String, dynamic>? payload,
  }) async {
    if (!_initialised) {
      // Best-effort init; if it fails we silently drop the notification
      // rather than crash the app.
      await init();
      if (!_initialised) return;
    }
    final NotificationDetails details = NotificationDetails(
      android: AndroidNotificationDetails(
        defaultChannel.id,
        defaultChannel.name,
        channelDescription: defaultChannel.description,
        importance: Importance.high,
        priority: Priority.high,
      ),
      iOS: const DarwinNotificationDetails(),
      macOS: const DarwinNotificationDetails(),
    );
    try {
      await _plugin.show(
        id,
        title,
        body,
        details,
        payload: payload == null ? null : jsonEncode(payload),
      );
    } catch (error) {
      debugPrint('LocalNotifications.show failed: $error');
    }
  }
}
