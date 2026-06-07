import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:sqflite/sqflite.dart';

import '../../../core/storage/database.dart';
import '../../../core/tenant/tenant_provider.dart';

/// Scholarship program model.
class ScholarshipProgram {
  const ScholarshipProgram({
    required this.id,
    required this.name,
    required this.description,
    required this.provider,
    this.amount,
    this.currency,
    this.eligibilityCriteria,
    this.deadline,
    this.applicationUrl,
    this.isOpen = true,
  });

  final String id;
  final String name;
  final String description;
  final String provider;
  final double? amount;
  final String? currency;
  final String? eligibilityCriteria;
  final String? deadline;
  final String? applicationUrl;
  final bool isOpen;

  factory ScholarshipProgram.fromJson(Map<String, dynamic> json) {
    return ScholarshipProgram(
      id: json['id'] as String,
      name: json['name'] as String,
      description: json['description'] as String,
      provider: json['provider'] as String,
      amount: (json['amount'] as num?)?.toDouble(),
      currency: json['currency'] as String?,
      eligibilityCriteria: json['eligibilityCriteria'] as String?,
      deadline: json['deadline'] as String?,
      applicationUrl: json['applicationUrl'] as String?,
      isOpen: json['isOpen'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'name': name,
        'description': description,
        'provider': provider,
        'amount': amount,
        'currency': currency,
        'eligibilityCriteria': eligibilityCriteria,
        'deadline': deadline,
        'applicationUrl': applicationUrl,
        'isOpen': isOpen,
      };

  /// Days remaining until deadline. Null if no deadline.
  int? get daysUntilDeadline {
    if (deadline == null) return null;
    final DateTime dl = DateTime.parse(deadline!);
    return dl.difference(DateTime.now()).inDays;
  }
}

/// Application status enum.
enum ScholarshipApplicationStatus {
  draft,
  submitted,
  underReview,
  approved,
  rejected,
  withdrawn;

  String toWire() => name;

  static ScholarshipApplicationStatus fromWire(String value) {
    return ScholarshipApplicationStatus.values.firstWhere(
      (ScholarshipApplicationStatus v) => v.name == value,
      orElse: () => ScholarshipApplicationStatus.draft,
    );
  }

  String get displayName {
    switch (this) {
      case ScholarshipApplicationStatus.draft:
        return 'Draft';
      case ScholarshipApplicationStatus.submitted:
        return 'Submitted';
      case ScholarshipApplicationStatus.underReview:
        return 'Under Review';
      case ScholarshipApplicationStatus.approved:
        return 'Approved';
      case ScholarshipApplicationStatus.rejected:
        return 'Rejected';
      case ScholarshipApplicationStatus.withdrawn:
        return 'Withdrawn';
    }
  }
}

/// Scholarship application model.
class ScholarshipApplication {
  const ScholarshipApplication({
    required this.id,
    required this.programId,
    required this.programName,
    required this.studentId,
    required this.status,
    this.submittedAt,
    this.reviewedAt,
    this.reviewerNotes,
    this.documents = const <String>[],
  });

  final String id;
  final String programId;
  final String programName;
  final String studentId;
  final ScholarshipApplicationStatus status;
  final String? submittedAt;
  final String? reviewedAt;
  final String? reviewerNotes;
  final List<String> documents;

  factory ScholarshipApplication.fromJson(Map<String, dynamic> json) {
    return ScholarshipApplication(
      id: json['id'] as String,
      programId: json['programId'] as String,
      programName: json['programName'] as String,
      studentId: json['studentId'] as String,
      status: ScholarshipApplicationStatus.fromWire(
          json['status'] as String? ?? 'draft'),
      submittedAt: json['submittedAt'] as String?,
      reviewedAt: json['reviewedAt'] as String?,
      reviewerNotes: json['reviewerNotes'] as String?,
      documents: (json['documents'] as List<dynamic>?)
              ?.map((dynamic e) => e as String)
              .toList(growable: false) ??
          const <String>[],
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'programId': programId,
        'programName': programName,
        'studentId': studentId,
        'status': status.toWire(),
        'submittedAt': submittedAt,
        'reviewedAt': reviewedAt,
        'reviewerNotes': reviewerNotes,
        'documents': documents,
      };
}

/// Repository for scholarship programs and applications.
class ScholarshipRepository {
  ScholarshipRepository({
    required AppDatabase database,
    required TenantProvider tenantProvider,
    required Dio dio,
  })  : _database = database,
        _tenantProvider = tenantProvider,
        _dio = dio;

  final AppDatabase _database;
  final TenantProvider _tenantProvider;
  final Dio _dio;

  /// Fetch available scholarship programs.
  Future<List<ScholarshipProgram>> getPrograms({
    bool openOnly = true,
  }) async {
    final String tenantId = _requireTenantId();

    try {
      final Response<dynamic> response = await _dio.get(
        '/api/v1/scholarships/programs',
        queryParameters: <String, dynamic>{
          if (openOnly) 'status': 'open',
        },
      );

      final List<dynamic> data = response.data['data'] as List<dynamic>;
      final List<ScholarshipProgram> programs = data
          .map((dynamic e) =>
              ScholarshipProgram.fromJson(e as Map<String, dynamic>))
          .toList(growable: false);

      await _cachePrograms(tenantId, programs);
      return programs;
    } on DioException {
      return _getCachedPrograms(tenantId, openOnly: openOnly);
    }
  }

  /// Submit a scholarship application.
  Future<ScholarshipApplication> submitApplication({
    required String programId,
    required String studentId,
    Map<String, dynamic>? additionalData,
    List<String>? documentIds,
  }) async {
    final Response<dynamic> response = await _dio.post(
      '/api/v1/scholarships/applications',
      data: <String, dynamic>{
        'programId': programId,
        'studentId': studentId,
        if (additionalData != null) ...additionalData,
        if (documentIds != null) 'documents': documentIds,
      },
    );

    return ScholarshipApplication.fromJson(
        response.data as Map<String, dynamic>);
  }

  /// Fetch applications for a student.
  Future<List<ScholarshipApplication>> getApplications({
    required String studentId,
  }) async {
    final String tenantId = _requireTenantId();

    try {
      final Response<dynamic> response = await _dio.get(
        '/api/v1/scholarships/applications',
        queryParameters: <String, dynamic>{'studentId': studentId},
      );

      final List<dynamic> data = response.data['data'] as List<dynamic>;
      final List<ScholarshipApplication> applications = data
          .map((dynamic e) =>
              ScholarshipApplication.fromJson(e as Map<String, dynamic>))
          .toList(growable: false);

      await _cacheApplications(tenantId, studentId, applications);
      return applications;
    } on DioException {
      return _getCachedApplications(tenantId, studentId);
    }
  }

  Future<void> _cachePrograms(
    String tenantId,
    List<ScholarshipProgram> programs,
  ) async {
    final Database db = await _database.database;
    await db.transaction((Transaction txn) async {
      await txn.delete(
        'scholarship_programs_cache',
        where: 'tenant_id = ?',
        whereArgs: <Object>[tenantId],
      );
      for (final ScholarshipProgram program in programs) {
        await txn.insert('scholarship_programs_cache', <String, Object?>{
          'id': program.id,
          'tenant_id': tenantId,
          'is_open': program.isOpen ? 1 : 0,
          'deadline': program.deadline,
          'payload': jsonEncode(program.toJson()),
        });
      }
    });
  }

  Future<List<ScholarshipProgram>> _getCachedPrograms(
    String tenantId, {
    bool openOnly = true,
  }) async {
    final Database db = await _database.database;
    final String where = openOnly
        ? 'tenant_id = ? AND is_open = 1'
        : 'tenant_id = ?';

    final List<Map<String, Object?>> rows = await db.query(
      'scholarship_programs_cache',
      where: where,
      whereArgs: <Object>[tenantId],
      orderBy: 'deadline ASC',
    );

    return rows.map((Map<String, Object?> row) {
      final Map<String, dynamic> json =
          jsonDecode(row['payload'] as String) as Map<String, dynamic>;
      return ScholarshipProgram.fromJson(json);
    }).toList(growable: false);
  }

  Future<void> _cacheApplications(
    String tenantId,
    String studentId,
    List<ScholarshipApplication> applications,
  ) async {
    final Database db = await _database.database;
    await db.transaction((Transaction txn) async {
      await txn.delete(
        'scholarship_applications_cache',
        where: 'tenant_id = ? AND student_id = ?',
        whereArgs: <Object>[tenantId, studentId],
      );
      for (final ScholarshipApplication app in applications) {
        await txn.insert('scholarship_applications_cache', <String, Object?>{
          'id': app.id,
          'tenant_id': tenantId,
          'student_id': app.studentId,
          'program_id': app.programId,
          'status': app.status.toWire(),
          'payload': jsonEncode(app.toJson()),
        });
      }
    });
  }

  Future<List<ScholarshipApplication>> _getCachedApplications(
    String tenantId,
    String studentId,
  ) async {
    final Database db = await _database.database;
    final List<Map<String, Object?>> rows = await db.query(
      'scholarship_applications_cache',
      where: 'tenant_id = ? AND student_id = ?',
      whereArgs: <Object>[tenantId, studentId],
    );

    return rows.map((Map<String, Object?> row) {
      final Map<String, dynamic> json =
          jsonDecode(row['payload'] as String) as Map<String, dynamic>;
      return ScholarshipApplication.fromJson(json);
    }).toList(growable: false);
  }

  String _requireTenantId() {
    final String? tenantId = _tenantProvider.tenantId;
    if (tenantId == null || tenantId.isEmpty) {
      throw StateError('No active tenant for scholarship repository.');
    }
    return tenantId;
  }
}
