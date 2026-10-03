import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/auth/auth_bloc.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/student/selected_student_store.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// PRC-M034: workspace switch and logout clear in-memory tenant, tokens,
/// selected student and caches.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });
  setUp(() => FlutterSecureStorage.setMockInitialValues(<String, String>{}));

  Future<
    ({
      SecureStorage secure,
      TenantProvider tenant,
      SelectedStudentStore student,
      AppDatabase db,
      AuthBloc auth,
    })
  >
  seed() async {
    final Directory dir = await Directory.systemTemp.createTemp('m034_');
    final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
    await secure.writeTokens(accessToken: 'a-old', refreshToken: 'r-old');
    final TenantProvider tenant = TenantProvider(secure);
    await tenant.setTenant(tenantId: 'tenant-old', displayName: 'Old');
    final SelectedStudentStore student = SelectedStudentStore(secure);
    await student.select(id: 'stu-old', displayName: 'Old Child');
    final AppDatabase db = AppDatabase(overridePath: '${dir.path}/m034.db');
    final Database raw = await db.database;
    await raw.insert('notifications_cache', <String, Object?>{
      'id': 'n1',
      'tenant_id': 'tenant-old',
      'title': 't',
      'body': 'b',
      'received_at': 1,
      'read': 0,
    });
    final AuthBloc auth = AuthBloc(
      secureStorage: secure,
      database: db,
      selectedStudent: student,
      tenantProvider: tenant,
    );
    return (
      secure: secure,
      tenant: tenant,
      student: student,
      db: db,
      auth: auth,
    );
  }

  Future<int> count(AppDatabase db, String table) async =>
      Sqflite.firstIntValue(
        await (await db.database).rawQuery('SELECT COUNT(*) FROM $table'),
      ) ??
      -1;

  test('switch tenant clears tokens, student, caches; activates new', () async {
    final ctx = await seed();
    ctx.auth.add(const AuthWorkspaceSwitchRequested(tenantId: 'tenant-new'));
    await ctx.auth.stream.firstWhere(
      (AuthState s) => s.status == AuthStatus.unauthenticated,
    );
    expect(await ctx.secure.readAccessToken(), isNull);
    expect(await ctx.secure.readRefreshToken(), isNull);
    expect(ctx.student.hasStudent, isFalse);
    expect(await ctx.secure.readSelectedStudentId(), isNull);
    expect(await count(ctx.db, 'notifications_cache'), 0);
    expect(ctx.tenant.tenantId, 'tenant-new');
    expect(ctx.tenant.displayName, isNot('Old'));
    expect(await ctx.secure.readTenantId(), 'tenant-new');
    await ctx.auth.close();
    await ctx.db.close();
  });

  test('logout clears the in-memory tenant too', () async {
    final ctx = await seed();
    ctx.auth.add(const AuthLogoutRequested());
    await ctx.auth.stream.firstWhere(
      (AuthState s) => s.status == AuthStatus.unauthenticated,
    );
    expect(ctx.tenant.tenantId, isNull);
    expect(ctx.tenant.hasTenant, isFalse);
    expect(ctx.student.hasStudent, isFalse);
    await ctx.auth.close();
    await ctx.db.close();
  });
}
