import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get_it/get_it.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/attendance/presentation/attendance_reports_screen.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory tempDir;

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{
      SecureStorage.tenantIdKey: 'demo-school',
      SecureStorage.tenantNameKey: 'Demo School',
    });
    await GetIt.I.reset();
    tempDir = await Directory.systemTemp.createTemp('attendance_reports_');

    final SecureStorage storage = SecureStorage(const FlutterSecureStorage());
    final TenantProvider tenant = TenantProvider(storage);
    await tenant.bootstrap();

    final Dio dio = Dio(BaseOptions(baseUrl: 'https://example.test'));
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (RequestOptions options, RequestInterceptorHandler handler) {
          expect(options.path, '/api/v1/attendance/percentage');
          handler.resolve(
            Response<dynamic>(
              requestOptions: options,
              statusCode: 200,
              data: <String, dynamic>{
                'scope': 'institution',
                'totalRecords': 40,
                'presentCount': 30,
                'absentCount': 5,
                'excusedCount': 2,
                'lateCount': 3,
                'attendancePercentage': 82.5,
                'absencePercentage': 12.5,
              },
            ),
          );
        },
      ),
    );

    GetIt.I.registerSingleton<SecureStorage>(storage);
    GetIt.I.registerSingleton<TenantProvider>(tenant);
    GetIt.I.registerSingleton<Dio>(dio);
    GetIt.I.registerSingleton<AppDatabase>(
      AppDatabase(overridePath: '${tempDir.path}/test.db'),
    );
  });

  tearDown(() async {
    if (GetIt.I.isRegistered<AppDatabase>()) {
      await GetIt.I<AppDatabase>().close();
    }
    await GetIt.I.reset();
    if (tempDir.existsSync()) {
      await tempDir.delete(recursive: true);
    }
  });

  testWidgets('AttendanceReportsScreen loads percentage summary from API',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: AttendanceReportsScreen()),
    );
    await tester.pumpAndSettle();

    expect(find.text('Attendance reports'), findsOneWidget);
    expect(find.text('Load report'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Institution ID'),
      '11111111-1111-4111-8111-111111111111',
    );
    await tester.tap(find.text('Load report'));
    await tester.pumpAndSettle();

    expect(find.textContaining('82.50% attendance'), findsOneWidget);
    expect(find.text('Present'), findsOneWidget);
    expect(find.text('30'), findsOneWidget);
    expect(find.text('API'), findsOneWidget);
  });
}
