import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:sqflite/sqflite.dart';

import '../../../core/storage/database.dart';
import '../../../core/tenant/tenant_provider.dart';

/// Assessment result model.
class AssessmentResult {
  const AssessmentResult({
    required this.id,
    required this.studentId,
    required this.subjectName,
    required this.periodName,
    required this.score,
    this.maxScore,
    this.grade,
    this.remarks,
    this.assessedAt,
  });

  final String id;
  final String studentId;
  final String subjectName;
  final String periodName;
  final double score;
  final double? maxScore;
  final String? grade;
  final String? remarks;
  final String? assessedAt;

  factory AssessmentResult.fromJson(Map<String, dynamic> json) {
    return AssessmentResult(
      id: (json['id'] as String?) ??
          '${json['studentId']}_${json['subjectId']}_${json['academicPeriodId']}',
      studentId: (json['studentId'] as String?) ?? '',
      subjectName: (json['subjectName'] as String?) ??
          (json['subjectId'] as String?) ??
          'Subject',
      periodName: (json['periodName'] as String?) ??
          (json['academicPeriodId'] as String?) ??
          'Period',
      score: (json['weightedAverage'] as num?)?.toDouble() ??
          (json['score'] as num?)?.toDouble() ??
          0,
      maxScore: (json['maxScore'] as num?)?.toDouble() ?? 100,
      grade: (json['grade'] as String?) ?? (json['letterGrade'] as String?),
      remarks: json['remarks'] as String?,
      assessedAt: json['assessedAt'] as String?,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'studentId': studentId,
        'subjectName': subjectName,
        'periodName': periodName,
        'score': score,
        'maxScore': maxScore,
        'grade': grade,
        'remarks': remarks,
        'assessedAt': assessedAt,
      };

  double get percentage =>
      maxScore != null && maxScore! > 0 ? (score / maxScore!) * 100 : 0;
}

/// Grading scheme summary from `GET /api/v1/grading-schemes`.
class GradingSchemeSummary {
  const GradingSchemeSummary({
    required this.id,
    required this.name,
    required this.type,
    required this.minValue,
    required this.maxValue,
    this.thresholds = const <Map<String, dynamic>>[],
  });

  final String id;
  final String name;
  final String type;
  final double minValue;
  final double maxValue;
  final List<Map<String, dynamic>> thresholds;

  factory GradingSchemeSummary.fromJson(Map<String, dynamic> json) {
    return GradingSchemeSummary(
      id: json['id'] as String,
      name: (json['name'] as String?) ?? 'Unnamed scheme',
      type: (json['type'] as String?) ?? 'numeric',
      minValue: (json['minValue'] as num?)?.toDouble() ?? 0,
      maxValue: (json['maxValue'] as num?)?.toDouble() ?? 100,
      thresholds: (json['thresholds'] as List<dynamic>?)
              ?.whereType<Map>()
              .map((Map e) => Map<String, dynamic>.from(e))
              .toList(growable: false) ??
          const <Map<String, dynamic>>[],
    );
  }
}

/// Repository for assessment results with offline caching.
class AssessmentRepository {
  AssessmentRepository({
    required AppDatabase database,
    required TenantProvider tenantProvider,
    required Dio dio,
  })  : _database = database,
        _tenantProvider = tenantProvider,
        _dio = dio;

  final AppDatabase _database;
  final TenantProvider _tenantProvider;
  final Dio _dio;

  static const String _cacheTable = 'assessment_results_cache';

  /// Fetch assessment results for a student, with offline cache fallback.
  ///
  /// Tries the gateway grades endpoint when subject + period are known;
  /// otherwise falls back to the legacy `/assessments/results` path used by
  /// older deployments, then to the local cache.
  Future<List<AssessmentResult>> getResults({
    required String studentId,
    String? subjectFilter,
    String? periodFilter,
  }) async {
    final String tenantId = _requireTenantId();

    try {
      if (subjectFilter != null &&
          subjectFilter.isNotEmpty &&
          periodFilter != null &&
          periodFilter.isNotEmpty) {
        final Response<dynamic> grades = await _dio.get(
          '/api/v1/results/grades',
          queryParameters: <String, dynamic>{
            'studentId': studentId,
            'subjectId': subjectFilter,
            'academicPeriodId': periodFilter,
          },
        );
        final List<AssessmentResult> fromGrades = _parseResults(grades.data);
        await _cacheResults(tenantId, studentId, fromGrades);
        return fromGrades;
      }

      final Response<dynamic> response = await _dio.get(
        '/api/v1/assessments/results',
        queryParameters: <String, dynamic>{
          'studentId': studentId,
          if (subjectFilter != null) 'subject': subjectFilter,
          if (periodFilter != null) 'period': periodFilter,
        },
      );

      final List<AssessmentResult> results = _parseResults(response.data);
      await _cacheResults(tenantId, studentId, results);
      return results;
    } on DioException {
      return _getCachedResults(tenantId, studentId,
          subjectFilter: subjectFilter, periodFilter: periodFilter);
    }
  }

  /// List grading schemes from `GET /api/v1/grading-schemes`.
  Future<List<GradingSchemeSummary>> listGradingSchemes({
    int page = 1,
    int pageSize = 50,
  }) async {
    final Response<dynamic> response = await _dio.get(
      '/api/v1/grading-schemes',
      queryParameters: <String, dynamic>{
        'page': page,
        'pageSize': pageSize,
      },
    );
    final Object? body = response.data;
    if (body is Map && body['data'] is List) {
      return (body['data'] as List)
          .whereType<Map>()
          .map((Map e) =>
              GradingSchemeSummary.fromJson(Map<String, dynamic>.from(e)))
          .toList(growable: false);
    }
    return const <GradingSchemeSummary>[];
  }

  List<AssessmentResult> _parseResults(Object? body) {
    if (body is Map && body['data'] is List) {
      return (body['data'] as List)
          .whereType<Map>()
          .map((Map e) => AssessmentResult.fromJson(Map<String, dynamic>.from(e)))
          .toList(growable: false);
    }
    if (body is List) {
      return body
          .whereType<Map>()
          .map((Map e) => AssessmentResult.fromJson(Map<String, dynamic>.from(e)))
          .toList(growable: false);
    }
    return const <AssessmentResult>[];
  }

  /// Get distinct subjects from cached results.
  Future<List<String>> getSubjects({required String studentId}) async {
    final String tenantId = _requireTenantId();
    final Database db = await _database.database;
    final List<Map<String, Object?>> rows = await db.rawQuery(
      'SELECT DISTINCT subject_name FROM $_cacheTable '
      'WHERE tenant_id = ? AND student_id = ? ORDER BY subject_name',
      <Object>[tenantId, studentId],
    );
    return rows
        .map((Map<String, Object?> r) => r['subject_name'] as String)
        .toList(growable: false);
  }

  /// Get distinct periods from cached results.
  Future<List<String>> getPeriods({required String studentId}) async {
    final String tenantId = _requireTenantId();
    final Database db = await _database.database;
    final List<Map<String, Object?>> rows = await db.rawQuery(
      'SELECT DISTINCT period_name FROM $_cacheTable '
      'WHERE tenant_id = ? AND student_id = ? ORDER BY period_name',
      <Object>[tenantId, studentId],
    );
    return rows
        .map((Map<String, Object?> r) => r['period_name'] as String)
        .toList(growable: false);
  }

  Future<void> _cacheResults(
    String tenantId,
    String studentId,
    List<AssessmentResult> results,
  ) async {
    final Database db = await _database.database;
    await db.transaction((Transaction txn) async {
      await txn.delete(
        _cacheTable,
        where: 'tenant_id = ? AND student_id = ?',
        whereArgs: <Object>[tenantId, studentId],
      );
      for (final AssessmentResult result in results) {
        await txn.insert(_cacheTable, <String, Object?>{
          'id': result.id,
          'tenant_id': tenantId,
          'student_id': result.studentId,
          'subject_name': result.subjectName,
          'period_name': result.periodName,
          'score': result.score,
          'max_score': result.maxScore,
          'grade': result.grade,
          'remarks': result.remarks,
          'assessed_at': result.assessedAt,
          'payload': jsonEncode(result.toJson()),
        });
      }
    });
  }

  Future<List<AssessmentResult>> _getCachedResults(
    String tenantId,
    String studentId, {
    String? subjectFilter,
    String? periodFilter,
  }) async {
    final Database db = await _database.database;
    final StringBuffer where = StringBuffer('tenant_id = ? AND student_id = ?');
    final List<Object> args = <Object>[tenantId, studentId];

    if (subjectFilter != null) {
      where.write(' AND subject_name = ?');
      args.add(subjectFilter);
    }
    if (periodFilter != null) {
      where.write(' AND period_name = ?');
      args.add(periodFilter);
    }

    final List<Map<String, Object?>> rows = await db.query(
      _cacheTable,
      where: where.toString(),
      whereArgs: args,
      orderBy: 'subject_name ASC, period_name ASC',
    );

    return rows.map((Map<String, Object?> row) {
      final Map<String, dynamic> json =
          jsonDecode(row['payload'] as String) as Map<String, dynamic>;
      return AssessmentResult.fromJson(json);
    }).toList(growable: false);
  }

  String _requireTenantId() {
    final String? tenantId = _tenantProvider.tenantId;
    if (tenantId == null || tenantId.isEmpty) {
      throw StateError('No active tenant for assessment repository.');
    }
    return tenantId;
  }
}
