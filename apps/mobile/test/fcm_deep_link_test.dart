import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:proctira_mobile/core/notifications/fcm_service.dart';
import 'package:proctira_mobile/core/notifications/local_notifications.dart';
import 'package:proctira_mobile/core/notifications/notification_router.dart';
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
  @override
  Future<void> init({void Function(String? payload)? onTap}) async {}

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeDeviceApi implements NotificationDeviceApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Only [getInitialMessage] is used; permission/token calls throw and are
/// swallowed by [FcmService.start] (same as a device without APNs/FCM).
class _FakeMessaging implements FirebaseMessaging {
  _FakeMessaging(this.initial);
  final RemoteMessage? initial;

  @override
  Future<RemoteMessage?> getInitialMessage() async => initial;

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError(invocation.memberName.toString());
}

RemoteMessage _reportReady(String id) => RemoteMessage(
  messageId: 'm-$id',
  data: <String, dynamic>{'type': 'REPORT_READY', 'entityId': id},
);

/// PRC-M564: push routing through the real [FcmService] + [NotificationRouter]
/// for both `onMessageOpenedApp` and `getInitialMessage`.
void main() {
  late StreamController<RemoteMessage> opened;

  setUp(() => opened = StreamController<RemoteMessage>.broadcast());
  tearDown(() => opened.close());

  ({FcmService fcm, _FakeRepo repo}) build({RemoteMessage? initial}) {
    final _FakeRepo repo = _FakeRepo();
    final FcmService fcm = FcmService(
      deviceApi: _FakeDeviceApi(),
      repository: repo,
      router: const NotificationRouter(),
      localNotifications: _FakeLocal(),
      messaging: _FakeMessaging(initial),
      firebaseInitialiser: (FirebaseOptions? _) async {},
      onMessage: const Stream<RemoteMessage>.empty(),
      onMessageOpenedApp: opened.stream,
      registerBackgroundHandler: (BackgroundMessageHandler _) {},
    );
    return (fcm: fcm, repo: repo);
  }

  test(
    'notification opened while running routes via NotificationRouter',
    () async {
      final ctx = build();
      final List<String> routes = <String>[];
      bindPushDeepLinks(ctx.fcm.deepLinks, routes.add);
      final Future<FcmDeepLink> next = ctx.fcm.deepLinks.first;

      expect(await ctx.fcm.start(), isTrue);
      opened.add(_reportReady('enrollment-summary'));
      final FcmDeepLink link = await next.timeout(const Duration(seconds: 2));

      expect(link.source, FcmDeepLinkSource.messageOpened);
      expect(link.route, '/reports/enrollment-summary');
      expect(routes, <String>['/reports/enrollment-summary']);
      expect(ctx.repo.inserted, hasLength(1));
    },
  );

  test(
    'cold start from a notification emits the initial-message deep link',
    () async {
      final ctx = build(initial: _reportReady('fees-due'));
      final Future<FcmDeepLink> next = ctx.fcm.deepLinks.first;

      await ctx.fcm.start();
      final FcmDeepLink link = await next.timeout(const Duration(seconds: 2));

      expect(link.source, FcmDeepLinkSource.initialMessage);
      expect(link.route, '/reports/fees-due');
    },
  );
}
