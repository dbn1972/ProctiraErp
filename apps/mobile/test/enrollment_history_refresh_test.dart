import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/di/injector.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/students/data/enrollment_repository.dart';
import 'package:proctira_mobile/features/students/presentation/enrollment_history_screen.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/fake_dio.dart';

/// PRC-M041: enrollment history is fetched from the API, cache-first
/// offline with a stale marker.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late AppDatabase db;
  late FakeReply reply;
  final List<RequestOptions> seen = <RequestOptions>[];

  Future<void> setUpDeps() async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    final Directory dir = await Directory.systemTemp.createTemp('m041_');
    db = AppDatabase(overridePath: '${dir.path}/m041.db');
    final TenantProvider tenant = TenantProvider(
      SecureStorage(const FlutterSecureStorage()),
    );
    await tenant.setTenant(tenantId: 'tenant-a');
    getIt
      ..registerSingleton<AppDatabase>(db)
      ..registerSingleton<TenantProvider>(tenant)
      ..registerSingleton<Dio>(
        fakeDio((RequestOptions o) {
          seen.add(o);
          return reply;
        }),
      );
  }

  tearDown(() async {
    await getIt.reset();
    await db.close();
    seen.clear();
  });

  Future<void> pump(WidgetTester tester) async {
    await tester.runAsync(() async {
      await tester.pumpWidget(
        const MaterialApp(home: EnrollmentHistoryScreen(studentId: 'stu-1')),
      );
      for (int i = 0; i < 20; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
        await tester.pump();
      }
    });
    await tester.pump();
  }

  testWidgets('stubbed API -> screen shows entries', (WidgetTester t) async {
    await t.runAsync(setUpDeps);
    reply = const FakeReply(200, <String, dynamic>{
      'data': <Map<String, dynamic>>[
        <String, dynamic>{
          'id': 'e1',
          'studentId': 'stu-1',
          'institutionId': 'inst-1',
          'academicPeriodId': '2025-26',
          'status': 'ENROLLED',
          'enrolledAt': '2025-06-01',
        },
      ],
    });
    await pump(t);
    expect(seen.single.path, '/api/v1/enrollments');
    expect(seen.single.queryParameters['studentId'], 'stu-1');
    expect(find.text('2025-26'), findsWidgets);
    expect(find.textContaining('Showing saved history'), findsNothing);
  });

  testWidgets('offline -> cached rows with stale marker', (
    WidgetTester t,
  ) async {
    await t.runAsync(() async {
      await setUpDeps();
      await EnrollmentRepository(
        database: db,
        tenantProvider: getIt<TenantProvider>(),
      ).upsert(
        EnrollmentEntry(
          id: 'e-old',
          studentId: 'stu-1',
          academicPeriodId: '2024-25',
          status: 'ENROLLED',
          enrolledAt: '2024-06-01',
        ),
      );
    });
    reply = const FakeReply.fail(DioExceptionType.connectionError);
    await pump(t);
    expect(find.text('2024-25'), findsWidgets);
    expect(find.textContaining('Showing saved history'), findsOneWidget);
  });

  testWidgets('403 surfaces an error, not saved data', (WidgetTester t) async {
    await t.runAsync(setUpDeps);
    reply = const FakeReply(403, <String, dynamic>{'message': 'no'});
    await pump(t);
    expect(find.text('Something went wrong'), findsOneWidget);
  });
}
