import 'dart:typed_data';

import 'package:dio/dio.dart';

import 'api_client.dart';

/// Report summary returned by the jobs / templates endpoints.
class ReportSummary {
  const ReportSummary({
    required this.id,
    required this.title,
    required this.description,
    required this.status,
    required this.format,
    this.createdAt,
    this.completedAt,
    this.reportType,
    this.errorMessage,
    this.rowCount,
    this.isTemplate = false,
  });

  final String id;
  final String title;
  final String description;
  final String status; // 'pending' | 'processing' | 'completed' | 'failed' | 'template'
  final String format; // 'xlsx' | 'pdf' | 'csv'
  final String? createdAt;
  final String? completedAt;
  final String? reportType;
  final String? errorMessage;
  final int? rowCount;
  final bool isTemplate;

  factory ReportSummary.fromJson(
    Map<String, dynamic> json, {
    bool isTemplate = false,
  }) {
    if (isTemplate) {
      return ReportSummary(
        id: json['id'] as String,
        title: (json['name'] as String?) ?? 'Untitled template',
        description: (json['type'] as String?) ?? 'Report template',
        status: 'template',
        format: (json['format'] as String?) ?? 'pdf',
        createdAt: json['createdAt'] as String?,
        reportType: json['type'] as String?,
        isTemplate: true,
      );
    }
    return ReportSummary(
      id: json['id'] as String,
      title: (json['title'] as String?) ??
          (json['reportType'] as String?) ??
          'Untitled Report',
      description: (json['reportType'] as String?) ??
          (json['description'] as String?) ??
          '',
      status: (json['status'] as String?) ?? 'pending',
      format: (json['format'] as String?) ?? 'pdf',
      createdAt: json['createdAt'] as String?,
      completedAt: json['completedAt'] as String?,
      reportType: json['reportType'] as String?,
      errorMessage: json['errorMessage'] as String?,
      rowCount: json['rowCount'] as int?,
    );
  }
}

/// Typed wrapper around `/api/v1/reports` job + template endpoints.
class ReportApi extends BaseApi {
  ReportApi(super.dio);

  static const String _basePath = '/api/v1/reports';

  /// Fetch generated report jobs for the current user.
  Future<List<ReportSummary>> listReports({
    int page = 1,
    int pageSize = 20,
  }) async {
    final Response<dynamic> response = await request<dynamic>(
      '$_basePath/jobs',
      method: 'GET',
      queryParameters: <String, dynamic>{
        'page': page,
        'pageSize': pageSize,
      },
    );
    final Object? body = response.data;
    if (body is Map<String, dynamic> && body['data'] is List) {
      return (body['data'] as List)
          .whereType<Map>()
          .map((Map e) => ReportSummary.fromJson(Map<String, dynamic>.from(e)))
          .toList(growable: false);
    }
    return const <ReportSummary>[];
  }

  /// Fetch report templates for the tenant.
  Future<List<ReportSummary>> listTemplates() async {
    final Response<dynamic> response = await request<dynamic>(
      '$_basePath/templates',
      method: 'GET',
    );
    final Object? body = response.data;
    if (body is Map<String, dynamic> && body['data'] is List) {
      return (body['data'] as List)
          .whereType<Map>()
          .map(
            (Map e) => ReportSummary.fromJson(
              Map<String, dynamic>.from(e),
              isTemplate: true,
            ),
          )
          .toList(growable: false);
    }
    return const <ReportSummary>[];
  }

  /// Fetch the status of a specific report job.
  Future<ReportSummary> getReportStatus(String reportId) async {
    final Response<dynamic> response = await request<dynamic>(
      '$_basePath/jobs/$reportId',
      method: 'GET',
    );
    return _unwrapSummary(response.data);
  }

  /// Fetch a report template by id.
  Future<ReportSummary> getTemplate(String templateId) async {
    final Response<dynamic> response = await request<dynamic>(
      '$_basePath/templates/$templateId',
      method: 'GET',
    );
    return _unwrapSummary(response.data, isTemplate: true);
  }

  /// Resolve either a job or a template for a given id.
  Future<ReportSummary> getJobOrTemplate(String id) async {
    try {
      return await getReportStatus(id);
    } catch (_) {
      return getTemplate(id);
    }
  }

  /// Download the generated report file as raw bytes.
  Future<Uint8List> downloadReport(String reportId) async {
    final Response<List<int>> response = await dio.get<List<int>>(
      '$_basePath/jobs/$reportId/download',
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
      '$_basePath/generate',
      method: 'POST',
      data: <String, dynamic>{
        'reportType': reportType,
        'format': format,
        if (filters != null) 'filters': filters,
      },
    );
    return _unwrapSummary(response.data);
  }

  ReportSummary _unwrapSummary(Object? body, {bool isTemplate = false}) {
    if (body is Map) {
      final Map<String, dynamic> map = Map<String, dynamic>.from(body);
      final Object? data = map['data'];
      if (data is Map) {
        return ReportSummary.fromJson(
          Map<String, dynamic>.from(data),
          isTemplate: isTemplate,
        );
      }
      return ReportSummary.fromJson(map, isTemplate: isTemplate);
    }
    throw FormatException('Unexpected report response: $body');
  }
}
