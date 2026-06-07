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
      id: json['id'] as String,
      studentId: json['studentId'] as String,
      subjectName: json['subjectName'] as String,
      periodName: json['periodName'] as String,
      score: (json['score'] as num).toDouble(),
      maxScore: (json['maxScore'] as num?)?.toDouble(),
      grade: json['grade'] as String?,
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
  Future<List<AssessmentResult>> getResults({
    required String studentId,
    String? subjectFilter,
    String? periodFilter,
  }) async {
    final String tenantId = _requireTenantId();

    // Try API first.
    try {
      final Response<dynamic> response = await _dio.get(
        '/api/v1/assessments/results',
        queryParameters: <String, dynamic>{
          'studentId': studentId,
          if (subjectFilter != null) 'subject': subjectFilter,
          if (periodFilter != null) 'period': periodFilter,
        },
      );

      final List<dynamic> data = response.data['data'] as List<dynamic>;
      final List<AssessmentResult> results = data
          .map((dynamic e) =>
              AssessmentResult.fromJson(e as Map<String, dynamic>))
          .toList(growable: false);

      // Cache results.
      await _cacheResults(tenantId, studentId, results);
      return results;
    } on DioException {
      // Fall back to cache.
      return _getCachedResults(tenantId, studentId,
          subjectFilter: subjectFilter, periodFilter: periodFilter);
    }
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
