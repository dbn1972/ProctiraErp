import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/institutions/data/institution_repository.dart';
import 'package:proctira_mobile/features/notifications/data/notification_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// PRC-M036: a null tenant scope must never widen cache reads/writes to
/// every tenant, and markRead must not touch another tenant's row.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late AppDatabase db;
  late TenantProvider tenant;

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    final Directory dir = await Directory.systemTemp.createTemp('null_scope_');
    db = AppDatabase(overridePath: '${dir.path}/n.db');
    final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
    await secure.writeTenant(tenantId: 'tenant-a', displayName: 'A');
    tenant = TenantProvider(secure);
    await tenant.bootstrap();
  });

  Future<void> seedTwoTenants(NotificationRepository repo) async {
    await repo.insert(id: 'n-a', tenantId: 'tenant-a', title: 'A notice');
    await repo.insert(id: 'n-b', tenantId: 'tenant-b', title: 'B notice');
  }

  test(
    'notifications: null tenant returns nothing and changes nothing',
    () async {
      final NotificationRepository repo = NotificationRepository(
        database: db,
        tenantProvider: tenant,
      );
      await seedTwoTenants(repo);
      await tenant.clear();

      expect(await repo.listAll(), isEmpty);
      expect(await repo.markAllRead(), 0);
      expect(await repo.deleteAll(), 0);
      expect(await repo.markRead('n-a'), 0);

      final Database raw = await db.database;
      expect(await raw.query('notifications_cache'), hasLength(2));
    },
  );

  test('notifications: markRead ignores another tenant\'s id', () async {
    final NotificationRepository repo = NotificationRepository(
      database: db,
      tenantProvider: tenant,
    );
    await seedTwoTenants(repo);
    expect(await repo.markRead('n-b'), 0);
    expect(await repo.markRead('n-a'), 1);
    expect((await repo.listAll()).map((CachedNotification n) => n.id), <String>[
      'n-a',
    ]);
  });

  test('institutions: null tenant returns nothing', () async {
    final Database raw = await db.database;
    for (final String t in <String>['tenant-a', 'tenant-b']) {
      await raw.insert('institutions_cache', <String, Object?>{
        'id': 'inst-$t',
        'tenant_id': t,
        'code': 'C-$t',
        'name': 'School $t',
        'payload': '{}',
        'updated_at': 1,
      });
    }
    final InstitutionRepository repo = InstitutionRepository(
      database: db,
      tenantProvider: tenant,
    );
    expect(await repo.list(), hasLength(1));
    await tenant.clear();
    expect(await repo.list(), isEmpty);
    expect(await repo.findById('inst-tenant-a'), isNull);
  });
}
