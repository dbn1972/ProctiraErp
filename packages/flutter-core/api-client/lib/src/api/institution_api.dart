import 'package:dio/dio.dart';

import '../models/institution.dart';
import 'api_client.dart';

/// Typed wrapper around `/api/v1/institutions` endpoints.
class InstitutionApi extends BaseApi {
  InstitutionApi(super.dio);

  static const String _basePath = '/api/v1/institutions';

  /// One page of institutions visible to the caller (PRC-M037).
  Future<List<Institution>> listInstitutions({
    int page = 1,
    int pageSize = 100,
  }) async {
    final Response<dynamic> response = await request<dynamic>(
      _basePath,
      method: 'GET',
      queryParameters: <String, dynamic>{'page': page, 'pageSize': pageSize},
    );
    final Object? body = response.data;
    final Object? data = body is Map<String, dynamic> ? body['data'] : body;
    if (data is List) {
      return data
          .whereType<Map<String, dynamic>>()
          .map(Institution.fromJson)
          .toList(growable: false);
    }
    return const <Institution>[];
  }

  Future<Institution> fetchInstitution(String id) async {
    final Response<dynamic> response = await request<dynamic>(
      '$_basePath/$id',
      method: 'GET',
    );
    final Object? body = response.data;
    if (body is Map<String, dynamic>) {
      final Object? data = body['data'];
      if (data is Map<String, dynamic>) return Institution.fromJson(data);
      return Institution.fromJson(body);
    }
    throw FormatException('Unexpected institution response: $body');
  }

  /// Fetch academic periods for an institution.
  Future<List<Map<String, dynamic>>> fetchAcademicPeriods(
    String institutionId,
  ) async {
    final Response<dynamic> response = await request<dynamic>(
      '$_basePath/$institutionId/academic-periods',
      method: 'GET',
    );
    final Object? body = response.data;
    if (body is Map<String, dynamic> && body['data'] is List) {
      return (body['data'] as List)
          .whereType<Map<String, dynamic>>()
          .toList(growable: false);
    }
    return const <Map<String, dynamic>>[];
  }

  /// Fetch infrastructure (buildings, rooms) for an institution.
  Future<List<Map<String, dynamic>>> fetchInfrastructure(
    String institutionId,
  ) async {
    final Response<dynamic> response = await request<dynamic>(
      '$_basePath/$institutionId/infrastructure',
      method: 'GET',
    );
    final Object? body = response.data;
    if (body is Map<String, dynamic> && body['data'] is List) {
      return (body['data'] as List)
          .whereType<Map<String, dynamic>>()
          .toList(growable: false);
    }
    return const <Map<String, dynamic>>[];
  }

  /// Fetch contact information for an institution.
  Future<Map<String, dynamic>> fetchContactInfo(
    String institutionId,
  ) async {
    final Response<dynamic> response = await request<dynamic>(
      '$_basePath/$institutionId/contact',
      method: 'GET',
    );
    final Object? body = response.data;
    if (body is Map<String, dynamic>) {
      final Object? data = body['data'];
      if (data is Map<String, dynamic>) return data;
      return body;
    }
    return const <String, dynamic>{};
  }
}
