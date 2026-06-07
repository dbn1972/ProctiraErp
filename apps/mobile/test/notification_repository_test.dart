import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openemis_mobile/core/storage/database.dart';
import 'package:openemis_mobile/core/storage/secure_storage.dart';
import 'package:openemis_mobile/core/tenant/tenant_provider.dart';
import 'package:openemis_mobile/features/notifications/data/notification_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

Future<({AppDatabase db, TenantProvider tenant})> _bootstrap({
  String tenantId = 'tenant-a',
}) async {
  final Directory tempDir =
      await Directory.systemTemp.createTemp('notif_repo_');
  final AppDatabase db =
      AppDatabase(overridePath: '${tempDir.path}/openemis.db');
  final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
  await secure.writeTenant(tenantId: tenantId, displayName: 'Tenant A');
  final TenantProvider tenant = TenantProvider(secure);
  await tenant.bootstrap();
  return (db: db, tenant: tenant);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  test('insert + listAll returns rows scoped to the active tenant', () async {
    final ({AppDatabase db, TenantProvider tenant}) ctx = await _bootstrap();
    final NotificationRepository repo = NotificationRepository(
      database: ctx.db,
      tenantProvider: ctx.tenant,
    );

    await repo.insert(
      id: 'n-1',
      type: 'ATTENDANCE_THRESHOLD',
      title: 'Late arrivals spiking',
      body: 'Five students late today',
      payload: <String, dynamic>{'type': 'ATTENDANCE_THRESHOLD'},
      receivedAt: 200,
    );
    await repo.insert(
      id: 'n-2',
      type: 'WORKFLOW_APPROVAL',
      title: 'Approval requested',
      body: 'Approve student transfer',
      payload: <String, dynamic>{'type': 'WORKFLOW_APPROVAL'},
      receivedAt: 100,
    );

    final List<CachedNotification> rows = await repo.listAll();
    expect(rows, hasLength(2));
    // Most-recent-first ordering.
    expect(rows.first.id, 'n-1');
    expect(rows.first.title, 'Late arrivals spiking');
    expect(rows.first.read, isFalse);
    expect(rows.last.id, 'n-2');

    await ctx.db.close();
  });

  test('markRead flips a single row and is reflected on listAll', () async {
    final ({AppDatabase db, TenantProvider tenant}) ctx = await _bootstrap();
    final NotificationRepository repo = NotificationRepository(
      database: ctx.db,
      tenantProvider: ctx.tenant,
    );

    await repo.insert(id: 'n-1', title: 'A', receivedAt: 1);
    await repo.insert(id: 'n-2', title: 'B', receivedAt: 2);

    final int affected = await repo.markRead('n-1');
    expect(affected, 1);

    final List<CachedNotification> rows = await repo.listAll();
    final CachedNotification first =
        rows.firstWhere((CachedNotification n) => n.id == 'n-1');
    final CachedNotification second =
        rows.firstWhere((CachedNotification n) => n.id == 'n-2');
    expect(first.read, isTrue);
    expect(second.read, isFalse);

    await ctx.db.close();
  });

  test('markAllRead flips every row for the current tenant', () async {
    final ({AppDatabase db, TenantProvider tenant}) ctx = await _bootstrap();
    final NotificationRepository repo = NotificationRepository(
      database: ctx.db,
      tenantProvider: ctx.tenant,
    );

    await repo.insert(id: 'n-1', title: 'A', receivedAt: 1);
    await repo.insert(id: 'n-2', title: 'B', receivedAt: 2);

    final int affected = await repo.markAllRead();
    expect(affected, 2);

    final List<CachedNotification> rows = await repo.listAll();
    expect(rows.every((CachedNotification n) => n.read), isTrue);

    await ctx.db.close();
  });

  test('deleteAll wipes notifications for the current tenant', () async {
    final ({AppDatabase db, TenantProvider tenant}) ctx = await _bootstrap();
    final NotificationRepository repo = NotificationRepository(
      database: ctx.db,
      tenantProvider: ctx.tenant,
    );

    await repo.insert(id: 'n-1', title: 'A', receivedAt: 1);
    await repo.insert(id: 'n-2', title: 'B', receivedAt: 2);

    final int removed = await repo.deleteAll();
    expect(removed, 2);
    expect(await repo.listAll(), isEmpty);

    await ctx.db.close();
  });
}
