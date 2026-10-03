import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:sqflite/sqflite.dart';

import '../../../core/storage/cache_crypto.dart';
import '../../../core/storage/database.dart';
import '../../../core/tenant/tenant_provider.dart';

/// Examination schedule entry.
class Examination {
  const Examination({
    required this.id,
    required this.name,
    required this.subjectName,
    required this.examDate,
    required this.startTime,
    required this.endTime,
    this.venue,
    this.instructions,
    this.status = ExamStatus.upcoming,
  });

  final String id;
  final String name;
  final String subjectName;
  final String examDate;
  final String startTime;
  final String endTime;
  final String? venue;
  final String? instructions;
  final ExamStatus status;

  factory Examination.fromJson(Map<String, dynamic> json) {
    return Examination(
      id: json['id'] as String,
      name: json['name'] as String,
      subjectName: json['subjectName'] as String,
      examDate: json['examDate'] as String,
      startTime: json['startTime'] as String,
      endTime: json['endTime'] as String,
      venue: json['venue'] as String?,
      instructions: json['instructions'] as String?,
      status: ExamStatus.fromWire(json['status'] as String? ?? 'upcoming'),
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'name': name,
    'subjectName': subjectName,
    'examDate': examDate,
    'startTime': startTime,
    'endTime': endTime,
    'venue': venue,
    'instructions': instructions,
    'status': status.toWire(),
  };

  /// Calendar days remaining until the exam (0 = today, 1 = tomorrow).
  /// Negative means the exam date has passed.
  int get daysUntil => daysUntilFrom(DateTime.now());

  /// [daysUntil] against an injected clock. Compares calendar dates only so
  /// an exam tomorrow is 1 day away regardless of the current hour
  /// (PRC-L010). Uses the device-local calendar as the institution proxy.
  int daysUntilFrom(DateTime now) {
    final DateTime exam = DateTime.parse(examDate);
    final DateTime examDay = DateTime.utc(exam.year, exam.month, exam.day);
    final DateTime today = DateTime.utc(now.year, now.month, now.day);
    return examDay.difference(today).inDays;
  }

  /// Server status drives the upcoming/completed label, not the date maths.
  bool get isUpcoming =>
      status == ExamStatus.upcoming || status == ExamStatus.ongoing;
}

enum ExamStatus {
  upcoming,
  ongoing,
  completed,
  cancelled;

  String toWire() => name;

  static ExamStatus fromWire(String value) {
    return ExamStatus.values.firstWhere(
      (ExamStatus v) => v.name == value,
      orElse: () => ExamStatus.upcoming,
    );
  }
}

/// Examination result entry.
class ExaminationResult {
  const ExaminationResult({
    required this.id,
    required this.examinationId,
    required this.examinationName,
    required this.subjectName,
    required this.score,
    this.maxScore,
    this.grade,
    this.rank,
    this.remarks,
    this.publishedAt,
  });

  final String id;
  final String examinationId;
  final String examinationName;
  final String subjectName;
  final double score;
  final double? maxScore;
  final String? grade;
  final int? rank;
  final String? remarks;
  final String? publishedAt;

  factory ExaminationResult.fromJson(Map<String, dynamic> json) {
    return ExaminationResult(
      id: json['id'] as String,
      examinationId: json['examinationId'] as String,
      examinationName: json['examinationName'] as String,
      subjectName: json['subjectName'] as String,
      score: (json['score'] as num).toDouble(),
      maxScore: (json['maxScore'] as num?)?.toDouble(),
      grade: json['grade'] as String?,
      rank: json['rank'] as int?,
      remarks: json['remarks'] as String?,
      publishedAt: json['publishedAt'] as String?,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'examinationId': examinationId,
    'examinationName': examinationName,
    'subjectName': subjectName,
    'score': score,
    'maxScore': maxScore,
    'grade': grade,
    'rank': rank,
    'remarks': remarks,
    'publishedAt': publishedAt,
  };
}

/// Repository for examination schedules and results with offline caching.
class ExaminationRepository {
  ExaminationRepository({
    required AppDatabase database,
    required TenantProvider tenantProvider,
    required Dio dio,
    required CacheCrypto cacheCrypto,
  }) : _database = database,
       _tenantProvider = tenantProvider,
       _dio = dio,
       _cacheCrypto = cacheCrypto;

  final AppDatabase _database;
  final TenantProvider _tenantProvider;
  final Dio _dio;

  /// Seals cached exam schedules/results (child data) at rest (PRC-M035).
  final CacheCrypto _cacheCrypto;

  /// Fetch upcoming examinations for a student.
  Future<List<Examination>> getExaminations({
    required String studentId,
    bool upcomingOnly = true,
  }) async {
    final String tenantId = _requireTenantId();

    try {
      final Response<dynamic> response = await _dio.get(
        '/api/v1/examinations',
        queryParameters: <String, dynamic>{
          'studentId': studentId,
          if (upcomingOnly) 'status': 'upcoming',
        },
      );

      final List<dynamic> data =
          (response.data as Map<String, dynamic>)['data'] as List<dynamic>;
      final List<Examination> exams = data
          .map((dynamic e) => Examination.fromJson(e as Map<String, dynamic>))
          .toList(growable: false);

      await _cacheExaminations(tenantId, studentId, exams);
      return exams;
    } on DioException {
      return _getCachedExaminations(
        tenantId,
        studentId,
        upcomingOnly: upcomingOnly,
      );
    }
  }

  /// Fetch published examination results.
  Future<List<ExaminationResult>> getResults({
    required String studentId,
    String? examinationId,
  }) async {
    final String tenantId = _requireTenantId();

    try {
      final Response<dynamic> response = await _dio.get(
        '/api/v1/examinations/results',
        queryParameters: <String, dynamic>{
          'studentId': studentId,
          'examinationId': ?examinationId,
        },
      );

      final List<dynamic> data =
          (response.data as Map<String, dynamic>)['data'] as List<dynamic>;
      final List<ExaminationResult> results = data
          .map(
            (dynamic e) =>
                ExaminationResult.fromJson(e as Map<String, dynamic>),
          )
          .toList(growable: false);

      await _cacheResults(tenantId, studentId, results);
      return results;
    } on DioException {
      return _getCachedResults(tenantId, studentId);
    }
  }

  Future<void> _cacheExaminations(
    String tenantId,
    String studentId,
    List<Examination> exams,
  ) async {
    final Database db = await _database.database;
    await db.transaction((Transaction txn) async {
      await txn.delete(
        'examinations_cache',
        where: 'tenant_id = ? AND student_id = ?',
        whereArgs: <Object>[tenantId, studentId],
      );
      for (final Examination exam in exams) {
        await txn.insert('examinations_cache', <String, Object?>{
          'id': exam.id,
          'tenant_id': tenantId,
          'student_id': studentId,
          'exam_date': exam.examDate,
          'status': exam.status.toWire(),
          'payload': await _cacheCrypto.encrypt(jsonEncode(exam.toJson())),
        });
      }
    });
  }

  Future<List<Examination>> _getCachedExaminations(
    String tenantId,
    String studentId, {
    bool upcomingOnly = true,
  }) async {
    final Database db = await _database.database;
    final StringBuffer where = StringBuffer('tenant_id = ? AND student_id = ?');
    final List<Object> args = <Object>[tenantId, studentId];

    if (upcomingOnly) {
      where.write(" AND status = 'upcoming'");
    }

    final List<Map<String, Object?>> rows = await db.query(
      'examinations_cache',
      where: where.toString(),
      whereArgs: args,
      orderBy: 'exam_date ASC',
    );

    final List<Examination> exams = <Examination>[];
    for (final Map<String, Object?> row in rows) {
      final Map<String, dynamic> json =
          jsonDecode(await _cacheCrypto.decrypt(row['payload'] as String))
              as Map<String, dynamic>;
      exams.add(Examination.fromJson(json));
    }
    return exams;
  }

  Future<void> _cacheResults(
    String tenantId,
    String studentId,
    List<ExaminationResult> results,
  ) async {
    final Database db = await _database.database;
    await db.transaction((Transaction txn) async {
      await txn.delete(
        'examination_results_cache',
        where: 'tenant_id = ? AND student_id = ?',
        whereArgs: <Object>[tenantId, studentId],
      );
      for (final ExaminationResult result in results) {
        await txn.insert('examination_results_cache', <String, Object?>{
          'id': result.id,
          'tenant_id': tenantId,
          'student_id': studentId,
          'examination_id': result.examinationId,
          'payload': await _cacheCrypto.encrypt(jsonEncode(result.toJson())),
        });
      }
    });
  }

  Future<List<ExaminationResult>> _getCachedResults(
    String tenantId,
    String studentId,
  ) async {
    final Database db = await _database.database;
    final List<Map<String, Object?>> rows = await db.query(
      'examination_results_cache',
      where: 'tenant_id = ? AND student_id = ?',
      whereArgs: <Object>[tenantId, studentId],
    );

    final List<ExaminationResult> results = <ExaminationResult>[];
    for (final Map<String, Object?> row in rows) {
      final Map<String, dynamic> json =
          jsonDecode(await _cacheCrypto.decrypt(row['payload'] as String))
              as Map<String, dynamic>;
      results.add(ExaminationResult.fromJson(json));
    }
    return results;
  }

  String _requireTenantId() {
    final String? tenantId = _tenantProvider.tenantId;
    if (tenantId == null || tenantId.isEmpty) {
      throw StateError('No active tenant for examination repository.');
    }
    return tenantId;
  }
}
