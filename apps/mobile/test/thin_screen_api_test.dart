import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/core/tenant/tenant_provider.dart';
import 'package:proctira_mobile/features/examination/data/examination_repository.dart';
import 'package:proctira_mobile/features/scholarship/data/scholarship_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

Dio _dioWithHandlers(
  Map<String, dynamic> getResponses, {
  Map<String, dynamic>? postResponses,
}) {
  final Dio dio = Dio(BaseOptions(baseUrl: 'https://example.test'));
  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (RequestOptions options, RequestInterceptorHandler handler) {
        final String key = options.path;
        if (options.method == 'POST' && postResponses != null) {
          if (!postResponses.containsKey(key)) {
            handler.reject(
              DioException(
                requestOptions: options,
                response: Response<dynamic>(
                  requestOptions: options,
                  statusCode: 404,
                ),
                type: DioExceptionType.badResponse,
              ),
            );
            return;
          }
          handler.resolve(
            Response<dynamic>(
              requestOptions: options,
              statusCode: 201,
              data: postResponses[key],
            ),
          );
          return;
        }
        if (!getResponses.containsKey(key)) {
          handler.reject(
            DioException(
              requestOptions: options,
              response: Response<dynamic>(
                requestOptions: options,
                statusCode: 404,
              ),
              type: DioExceptionType.badResponse,
            ),
          );
          return;
        }
        handler.resolve(
          Response<dynamic>(
            requestOptions: options,
            statusCode: 200,
            data: getResponses[key],
          ),
        );
      },
    ),
  );
  return dio;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
  });

  group('ExaminationRepository.listCandidates', () {
    test('unwraps data array from GET /examinations/:id/candidates', () async {
      final Dio dio = _dioWithHandlers(<String, dynamic>{
        '/api/v1/examinations/exam-1/candidates': <String, dynamic>{
          'data': <Map<String, dynamic>>[
            <String, dynamic>{
              'id': 'c1',
              'examinationId': 'exam-1',
              'studentId': 'stu-1',
              'centerId': 'ctr-1',
              'subjectIds': <String>['sub-1'],
              'status': 'REGISTERED',
              'registeredAt': '2026-09-01T00:00:00.000Z',
            },
          ],
        },
      });
      final ExaminationRepository repo = ExaminationRepository(
        database: AppDatabase(),
        tenantProvider: TenantProvider(
          SecureStorage(const FlutterSecureStorage()),
        ),
        dio: dio,
      );
      final List<ExaminationCandidate> candidates =
          await repo.listCandidates('exam-1');
      expect(candidates, hasLength(1));
      expect(candidates.first.studentId, 'stu-1');
      expect(candidates.first.status, 'REGISTERED');
    });
  });

  group('ScholarshipRepository.uploadDocument', () {
    test('posts document metadata and returns fileUrl', () async {
      final Dio dio = _dioWithHandlers(
        const <String, dynamic>{},
        postResponses: <String, dynamic>{
          '/api/v1/scholarships/documents': <String, dynamic>{
            'id': 'doc-1',
            'documentType': 'supporting_document',
            'fileName': 'id.jpg',
            'fileUrl': '/api/v1/scholarships/documents/doc-1',
            'fileSize': 4,
          },
        },
      );
      final ScholarshipRepository repo = ScholarshipRepository(
        database: AppDatabase(),
        tenantProvider: TenantProvider(
          SecureStorage(const FlutterSecureStorage()),
        ),
        dio: dio,
      );

      final String path =
          '${Directory.systemTemp.path}/scholarship_upload_test.jpg';
      await File(path).writeAsBytes(<int>[1, 2, 3, 4]);

      final Map<String, dynamic> result = await repo.uploadDocument(
        filePath: path,
        fileName: 'id.jpg',
      );
      expect(result['fileUrl'], '/api/v1/scholarships/documents/doc-1');
      expect(result['fileName'], 'id.jpg');
    });
  });
}
