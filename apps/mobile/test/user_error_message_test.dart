import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/di/injector.dart';
import 'package:proctira_mobile/core/errors/user_error_message.dart';
import 'package:proctira_mobile/core/l10n/app_localizations.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/student/selected_student_store.dart';
import 'package:proctira_mobile/features/health/data/health_repository.dart';
import 'package:proctira_mobile/features/health/presentation/health_records_screen.dart';

DioException _dio(DioExceptionType type, {int? status, Object? data}) {
  final RequestOptions options = RequestOptions(
    path: 'https://api.internal.example/v1/health/s-1',
  );
  return DioException(
    requestOptions: options,
    type: type,
    response: status == null
        ? null
        : Response<dynamic>(
            requestOptions: options,
            statusCode: status,
            data: data,
          ),
    error: 'SocketException: OS Error: Connection refused, errno = 111',
  );
}

class _ThrowingHealthRepository implements HealthRepository {
  _ThrowingHealthRepository(this.error);
  final Object error;

  @override
  Future<HealthRecords> getRecords({required String studentId}) async =>
      throw error;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final RegExp _leak = RegExp(
  r'Exception|Error|errno|https?://|StackTrace|#\d+\s',
);

/// PRC-L015: user-visible errors never expose exception internals.
void main() {
  group('userErrorMessage', () {
    final Map<String, Object> cases = <String, Object>{
      'connection': _dio(DioExceptionType.connectionError),
      'timeout': _dio(DioExceptionType.receiveTimeout),
      '401': _dio(DioExceptionType.badResponse, status: 401),
      '403': _dio(DioExceptionType.badResponse, status: 403),
      '404': _dio(DioExceptionType.badResponse, status: 404),
      '500': _dio(
        DioExceptionType.badResponse,
        status: 500,
        data: <String, dynamic>{'message': 'PrismaClientKnownRequestError'},
      ),
      'unknown dio': _dio(DioExceptionType.unknown),
      'socket': const SocketException('Connection refused'),
      'timeout ex': TimeoutException('slow'),
      'format': const FormatException('Unexpected character at 1'),
      'state': StateError('Bad state: secret internals'),
      'arbitrary': Exception('boom at /srv/app/x.ts:12'),
    };
    cases.forEach((String name, Object error) {
      test('$name maps to a safe message', () {
        final String message = userErrorMessage(error);
        expect(message, isNotEmpty);
        expect(message, isNot(matches(_leak)), reason: message);
      });
    });

    test('4xx validation message from the API is passed through', () {
      expect(
        userErrorMessage(
          _dio(
            DioExceptionType.badResponse,
            status: 422,
            data: <String, dynamic>{'message': 'Phone number is invalid'},
          ),
        ),
        'Phone number is invalid',
      );
    });

    test('custom fallback is used for unknown errors', () {
      expect(
        userErrorMessage(Exception('x'), fallback: 'Try later'),
        'Try later',
      );
    });
  });

  testWidgets('health error view shows no exception class names', (
    WidgetTester tester,
  ) async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    if (!getIt.isRegistered<SelectedStudentStore>()) {
      getIt.registerSingleton<SelectedStudentStore>(
        SelectedStudentStore(SecureStorage(const FlutterSecureStorage())),
      );
    }
    addTearDown(() => getIt.unregister<SelectedStudentStore>());
    await tester.pumpWidget(
      RepositoryProvider<HealthRepository>.value(
        value: _ThrowingHealthRepository(
          _dio(DioExceptionType.badResponse, status: 500),
        ),
        child: const MaterialApp(
          localizationsDelegates: <LocalizationsDelegate<dynamic>>[
            AppLocalizations.delegate,
            DefaultMaterialLocalizations.delegate,
            DefaultWidgetsLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          home: HealthRecordsScreen(studentId: 'stu-1'),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(
      find.text('The server had a problem. Please try again later.'),
      findsOneWidget,
    );
    expect(find.textContaining('DioException'), findsNothing);
    expect(find.textContaining('Exception'), findsNothing);
    expect(find.textContaining('https://'), findsNothing);
  });
}
