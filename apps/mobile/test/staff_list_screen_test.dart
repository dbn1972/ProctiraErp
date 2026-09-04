import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get_it/get_it.dart';
import 'package:proctira_mobile/features/staff/data/staff_repository.dart';
import 'package:proctira_mobile/features/staff/presentation/staff_list_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() async {
    await GetIt.I.reset();
  });

  testWidgets('StaffListScreen renders directory rows',
      (WidgetTester tester) async {
    final Dio dio = Dio(BaseOptions(baseUrl: 'https://example.test'));
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (RequestOptions options, RequestInterceptorHandler handler) {
          handler.resolve(
            Response<dynamic>(
              requestOptions: options,
              statusCode: 200,
              data: <String, dynamic>{
                'data': <Map<String, dynamic>>[
                  <String, dynamic>{
                    'id': 's1',
                    'firstName': 'Sarat',
                    'lastName': 'Pradhan',
                    'position': 'Headmaster',
                    'status': 'ACTIVE',
                    'identityNumber': 'EMP-2104',
                  },
                ],
              },
            ),
          );
        },
      ),
    );
    GetIt.I.registerSingleton<StaffRepository>(StaffRepository(dio: dio));

    await tester.pumpWidget(
      const MaterialApp(home: StaffListScreen()),
    );
    await tester.pumpAndSettle();

    expect(find.text('Staff'), findsOneWidget);
    expect(find.text('Sarat Pradhan'), findsOneWidget);
    expect(find.textContaining('EMP-2104'), findsOneWidget);
    expect(find.text('Active'), findsOneWidget);
  });
}
