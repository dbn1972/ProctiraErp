import 'dart:io';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/notifications/data/notification_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

Future<NotificationRepository> _repo() async {
  final Directory dir = await Directory.systemTemp.createTemp('notif_dedup_');
  final AppDatabase db = AppDatabase(overridePath: '${dir.path}/proctira.db');
  final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
  await secure.writeTenant(tenantId: 'tenant-a', displayName: 'Tenant A');
  final TenantProvider tenant = TenantProvider(secure);
  await tenant.bootstrap();
  return NotificationRepository(database: db, tenantProvider: tenant);
}

/// PRC-L014: stable dedup ids and read flag preserved across refresh.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });
  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  test('same payload without messageId twice yields one row', () async {
    final NotificationRepository repo = await _repo();
    final DateTime sent = DateTime.utc(2026, 1, 1, 9);
    RemoteMessage build() => RemoteMessage(
      sentTime: sent,
      data: <String, dynamic>{'type': 'REPORT_READY', 'entityId': 'r-1'},
      notification: const RemoteNotification(title: 'Report ready'),
    );
    await repo.upsertFromRemote(build());
    await repo.upsertFromRemote(build());
    expect(await repo.listAll(), hasLength(1));
  });

  test('content id is key-order independent and content sensitive', () {
    expect(
      NotificationRepository.stableContentId(<String, dynamic>{'a': 1, 'b': 2}),
      NotificationRepository.stableContentId(<String, dynamic>{'b': 2, 'a': 1}),
    );
    expect(
      NotificationRepository.stableContentId(<String, dynamic>{'a': 1}),
      isNot(NotificationRepository.stableContentId(<String, dynamic>{'a': 2})),
    );
  });

  test('read flag is preserved after inbox refresh and re-delivery', () async {
    final NotificationRepository repo = await _repo();
    await repo.replaceWith(<Map<String, dynamic>>[
      <String, dynamic>{'id': 'n-1', 'title': 'Hello', 'read': false},
    ]);
    await repo.markRead('n-1');

    await repo.replaceWith(<Map<String, dynamic>>[
      <String, dynamic>{'id': 'n-1', 'title': 'Hello (edited)', 'read': false},
    ]);
    List<CachedNotification> rows = await repo.listAll();
    expect(rows, hasLength(1));
    expect(rows.single.read, isTrue);
    expect(rows.single.title, 'Hello (edited)');

    await repo.insert(id: 'n-1', title: 'Again');
    rows = await repo.listAll();
    expect(rows.single.read, isTrue);
  });

  test('refresh items without id dedupe by content', () async {
    final NotificationRepository repo = await _repo();
    final Map<String, dynamic> item = <String, dynamic>{
      'title': 'No id',
      'receivedAt': 1,
    };
    await repo.replaceWith(<Map<String, dynamic>>[item]);
    await repo.replaceWith(<Map<String, dynamic>>[
      Map<String, dynamic>.from(item),
    ]);
    expect(await repo.listAll(), hasLength(1));
  });
}
