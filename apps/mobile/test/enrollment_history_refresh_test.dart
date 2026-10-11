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

  /// Pumps the screen and waits until [until] is satisfied (or a generous
  /// timeout elapses), rather than a fixed real-time budget. The screen loads
  /// asynchronously (sqflite-ffi file I/O + a FutureBuilder), so a fixed
  /// `20 x 20ms` loop was timing-sensitive and flaked on loaded CI runners
  /// when the future had not resolved before the assertions ran. Polling the
  /// terminal condition makes the test deterministic without changing what it
  /// asserts.
  Future<void> pump(
    WidgetTester tester, {
    required bool Function() until,
  }) async {
    await tester.runAsync(() async {
      await tester.pumpWidget(
        const MaterialApp(home: EnrollmentHistoryScreen(studentId: 'stu-1')),
      );
      // Up to 5s (250 x 20ms) — far above the ~400ms the old loop allowed —
      // but returns as soon as the condition is met, so fast machines stay fast.
      for (int i = 0; i < 250; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
        await tester.pump();
        if (until()) break;
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
    await pump(t, until: () => find.text('2025-26').evaluate().isNotEmpty);
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
    await pump(t, until: () => find.text('2024-25').evaluate().isNotEmpty);
    expect(find.text('2024-25'), findsWidgets);
    expect(find.textContaining('Showing saved history'), findsOneWidget);
  });

  testWidgets('403 surfaces an error, not saved data', (WidgetTester t) async {
    await t.runAsync(setUpDeps);
    reply = const FakeReply(403, <String, dynamic>{'message': 'no'});
    await pump(
      t,
      until: () => find.text('Something went wrong').evaluate().isNotEmpty,
    );
    expect(find.text('Something went wrong'), findsOneWidget);
  });
}
