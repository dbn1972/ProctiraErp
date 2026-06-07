import 'dart:typed_data';

import 'package:dio/dio.dart';

import 'api_client.dart';

/// Report summary returned by the list endpoint.
class ReportSummary {
  const ReportSummary({
    required this.id,
    required this.title,
    required this.description,
    required this.status,
    required this.format,
    this.createdAt,
    this.completedAt,
  });

  final String id;
  final String title;
  final String description;
  final String status; // 'pending' | 'processing' | 'completed' | 'failed'
  final String format; // 'xlsx' | 'pdf' | 'csv'
  final String? createdAt;
  final String? completedAt;

  factory ReportSummary.fromJson(Map<String, dynamic> json) {
    return ReportSummary(
      id: json['id'] as String,
      title: (json['title'] as String?) ?? 'Untitled Report',
      description: (json['description'] as String?) ?? '',
      status: (json['status'] as String?) ?? 'pending',
      format: (json['format'] as String?) ?? 'pdf',
      createdAt: json['createdAt'] as String?,
      completedAt: json['completedAt'] as String?,
    );
  }
}

/// Typed wrapper around `/api/v1/reports` endpoints.
class ReportApi extends BaseApi {
  ReportApi(super.dio);

  static const String _basePath = '/api/v1/reports';

  /// Fetch the list of available/generated reports for the current user.
  Future<List<ReportSummary>> listReports({
    int page = 1,
    int pageSize = 20,
  }) async {
    final Response<dynamic> response = await request<dynamic>(
      _basePath,
      method: 'GET',
      queryParameters: <String, dynamic>{
        'page': page,
        'pageSize': pageSize,
      },
    );
    final Object? body = response.data;
    if (body is Map<String, dynamic> && body['data'] is List) {
      return (body['data'] as List)
          .whereType<Map<String, dynamic>>()
          .map(ReportSummary.fromJson)
          .toList(growable: false);
    }
    return const <ReportSummary>[];
  }

  /// Fetch the status of a specific report job.
  Future<ReportSummary> getReportStatus(String reportId) async {
    final Response<dynamic> response = await request<dynamic>(
      '$_basePath/$reportId',
      method: 'GET',
    );
    final Object? body = response.data;
    if (body is Map<String, dynamic>) {
      final Object? data = body['data'];
      if (data is Map<String, dynamic>) return ReportSummary.fromJson(data);
      return ReportSummary.fromJson(body);
    }
    throw FormatException('Unexpected report response: $body');
  }

  /// Download the generated report file as raw bytes.
  Future<Uint8List> downloadReport(String reportId) async {
    final Response<List<int>> response = await dio.get<List<int>>(
      '$_basePath/$reportId/download',
      options: Options(responseType: ResponseType.bytes),
    );
    return Uint8List.fromList(response.data ?? const <int>[]);
  }

  /// Request generation of a new report.
  Future<ReportSummary> requestReport({
    required String reportType,
    required String format,
    Map<String, dynamic>? filters,
  }) async {
    final Response<dynamic> response = await request<dynamic>(
      _basePath,
      method: 'POST',
      data: <String, dynamic>{
        'reportType': reportType,
        'format': format,
        // ignore: use_null_aware_elements
        if (filters != null) 'filters': filters,
      },
    );
    final Object? body = response.data;
    if (body is Map<String, dynamic>) {
      final Object? data = body['data'];
      if (data is Map<String, dynamic>) return ReportSummary.fromJson(data);
      return ReportSummary.fromJson(body);
    }
    throw FormatException('Unexpected report creation response: $body');
  }
}
