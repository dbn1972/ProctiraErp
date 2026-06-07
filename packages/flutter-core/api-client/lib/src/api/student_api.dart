import 'package:dio/dio.dart';

import '../models/student.dart';
import 'api_client.dart';

/// Typed wrapper around `/api/v1/students` endpoints.
class StudentApi extends BaseApi {
  StudentApi(super.dio);

  static const String _basePath = '/api/v1/students';

  /// Fetch a paginated list of students (used to seed the local cache when
  /// the device comes back online).
  Future<List<Student>> listStudents({
    int page = 1,
    int pageSize = 20,
    String? institutionId,
  }) async {
    final Response<dynamic> response = await request<dynamic>(
      _basePath,
      method: 'GET',
      queryParameters: <String, dynamic>{
        'page': page,
        'pageSize': pageSize,
        'institutionId': ?institutionId,
      },
    );
    final Object? body = response.data;
    if (body is Map<String, dynamic> && body['data'] is List) {
      return (body['data'] as List)
          .whereType<Map<String, dynamic>>()
          .map(Student.fromJson)
          .toList(growable: false);
    }
    return const <Student>[];
  }

  /// Fetch a single student by id.
  Future<Student> fetchStudent(String id) async {
    final Response<dynamic> response = await request<dynamic>(
      '$_basePath/$id',
      method: 'GET',
    );
    final Object? body = response.data;
    if (body is Map<String, dynamic>) {
      final Object? data = body['data'];
      if (data is Map<String, dynamic>) return Student.fromJson(data);
      return Student.fromJson(body);
    }
    throw FormatException('Unexpected student response: $body');
  }
}
