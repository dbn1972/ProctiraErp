import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:proctira_mobile/core/notifications/fcm_service.dart';
import 'package:proctira_mobile/core/notifications/local_notifications.dart';
import 'package:proctira_mobile/core/notifications/notification_router.dart';
import 'package:proctira_mobile/features/notifications/data/local_notification_preferences.dart';
import 'package:proctira_mobile/features/notifications/data/notification_repository.dart';

class _FakeRepo implements NotificationRepository {
  final List<RemoteMessage> inserted = <RemoteMessage>[];

  @override
  Future<String> upsertFromRemote(RemoteMessage message) async {
    inserted.add(message);
    return 'id';
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeLocal implements LocalNotifications {
  final List<String> shown = <String>[];

  @override
  Future<void> show({
    required int id,
    required String title,
    required String body,
    Map<String, dynamic>? payload,
  }) async {
    shown.add(title);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeDeviceApi implements NotificationDeviceApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

RemoteMessage _msg(String type) => RemoteMessage(
  messageId: 'm-$type',
  data: <String, dynamic>{'type': type},
  notification: const RemoteNotification(title: 'Alert', body: 'Body'),
);

/// PRC-L013: device-local notification preferences are enforced.
void main() {
  ({FcmService fcm, _FakeRepo repo, _FakeLocal local}) build(
    LocalNotificationPreferences prefs,
  ) {
    final _FakeRepo repo = _FakeRepo();
    final _FakeLocal local = _FakeLocal();
    final FcmService fcm = FcmService(
      deviceApi: _FakeDeviceApi(),
      repository: repo,
      router: const NotificationRouter(),
      localNotifications: local,
      preferencesLoader: () async => prefs,
    );
    return (fcm: fcm, repo: repo, local: local);
  }

  test('disabled category is neither shown nor inserted', () async {
    final ctx = build(const LocalNotificationPreferences(reportReady: false));
    await ctx.fcm.handleForegroundMessage(_msg('REPORT_READY'));
    expect(ctx.repo.inserted, isEmpty);
    expect(ctx.local.shown, isEmpty);

    await ctx.fcm.handleForegroundMessage(_msg('EXAM_RESULT'));
    expect(ctx.repo.inserted, hasLength(1));
    expect(ctx.local.shown, hasLength(1));
  });

  test('push channel off suppresses banner but keeps inbox', () async {
    final ctx = build(const LocalNotificationPreferences(pushEnabled: false));
    await ctx.fcm.handleForegroundMessage(_msg('EXAM_RESULT'));
    expect(ctx.repo.inserted, hasLength(1));
    expect(ctx.local.shown, isEmpty);
  });

  test('in-app channel off skips inbox but still shows banner', () async {
    final ctx = build(const LocalNotificationPreferences(inAppEnabled: false));
    await ctx.fcm.handleForegroundMessage(_msg('EXAM_RESULT'));
    expect(ctx.repo.inserted, isEmpty);
    expect(ctx.local.shown, hasLength(1));
  });

  test('unknown types follow system announcements', () {
    const LocalNotificationPreferences prefs = LocalNotificationPreferences(
      systemAnnouncements: false,
    );
    expect(prefs.allowsCategory('INSTITUTION_UPDATE'), isFalse);
    expect(prefs.allowsCategory(null), isFalse);
    expect(prefs.allowsCategory('ATTENDANCE_THRESHOLD'), isTrue);
  });

  test('decode tolerates missing and corrupt payloads', () {
    expect(LocalNotificationPreferences.decode(null).pushEnabled, isTrue);
    expect(LocalNotificationPreferences.decode('not json').pushEnabled, isTrue);
    expect(
      LocalNotificationPreferences.decode('{"reportReady":false}').reportReady,
      isFalse,
    );
  });
}
