import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:http_parser/http_parser.dart';
import 'package:sqflite/sqflite.dart';

import '../../../core/errors/offline_fallback.dart';
import '../../../core/storage/cache_crypto.dart';
import '../../../core/storage/database.dart';
import '../../../core/tenant/tenant_provider.dart';
import 'scholarship_document_rules.dart';

String? _str(Object? v) => v is String ? v : null;

/// Scholarship program model.
///
/// Parses the backend contract (PRC-H015): staff `GET /scholarships/programs`
/// returns the full `ScholarshipProgramEntity` and parent
/// `GET /parent-portal/scholarships/programs` a subset. Neither has
/// `provider` / `isOpen` / `deadline`; the deadline is `applicationEndDate`,
/// the amount `amountPerRecipient`, and openness `status == 'open'`. The
/// legacy keys are still read so rows cached by older builds parse.
class ScholarshipProgram {
  const ScholarshipProgram({
    required this.id,
    required this.name,
    this.description = '',
    this.provider,
    this.amount,
    this.currency,
    this.eligibilityCriteria,
    this.deadline,
    this.applicationUrl,
    this.isOpen = true,
    this.requiredDocuments = const <String>[],
  });

  final String id;
  final String name;
  final String description;

  /// Not part of the backend contract; only shown when present.
  final String? provider;
  final double? amount;
  final String? currency;
  final String? eligibilityCriteria;
  final String? deadline;
  final String? applicationUrl;
  final bool isOpen;
  final List<String> requiredDocuments;

  factory ScholarshipProgram.fromJson(Map<String, dynamic> json) {
    final String? status = _str(json['status']);
    final Object? isOpen = json['isOpen'];
    return ScholarshipProgram(
      id: json['id'] as String,
      name: _str(json['name']) ?? '',
      description: _str(json['description']) ?? '',
      provider: _str(json['provider']),
      amount: ((json['amountPerRecipient'] ?? json['amount']) as num?)
          ?.toDouble(),
      currency: _str(json['currency']),
      eligibilityCriteria: _str(json['eligibilityCriteria']),
      deadline: _str(json['applicationEndDate']) ?? _str(json['deadline']),
      applicationUrl: _str(json['applicationUrl']),
      isOpen: status != null
          ? status == 'open'
          : (isOpen is bool ? isOpen : true),
      requiredDocuments: _requiredDocuments(json),
    );
  }

  static List<String> _requiredDocuments(Map<String, dynamic> json) {
    final Object? eligibility = json['eligibility'];
    final Object? raw = eligibility is Map
        ? eligibility['requiredDocuments']
        : json['requiredDocuments'];
    if (raw is! List) {
      return const <String>[];
    }
    return raw.whereType<String>().toList(growable: false);
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
    'requiredDocuments': requiredDocuments,
  };

  /// Days remaining until deadline. Null if no deadline or it cannot be parsed.
  int? get daysUntilDeadline {
    final String? raw = deadline;
    if (raw == null || raw.isEmpty) {
      return null;
    }
    final DateTime? dl = DateTime.tryParse(raw);
    if (dl == null) {
      return null;
    }
    return dl.difference(DateTime.now()).inDays;
  }

  /// Closed programs and deadlines that have already passed cannot be applied to.
  bool get acceptsApplications {
    if (!isOpen) {
      return false;
    }
    final int? days = daysUntilDeadline;
    if (days == null) {
      return true;
    }
    return days >= 0;
  }
}

/// Application status enum. Wire values are the backend's snake_case
/// `ApplicationStatus` (`under_review`); anything unrecognised is [unknown]
/// rather than silently shown as a draft (PRC-H015).
enum ScholarshipApplicationStatus {
  draft('draft'),
  submitted('submitted'),
  underReview('under_review'),
  approved('approved'),
  rejected('rejected'),
  withdrawn('withdrawn'),
  unknown('unknown');

  const ScholarshipApplicationStatus(this.wire);

  final String wire;

  String toWire() => wire;

  static ScholarshipApplicationStatus fromWire(String? value) {
    if (value == null) return ScholarshipApplicationStatus.unknown;
    for (final ScholarshipApplicationStatus v
        in ScholarshipApplicationStatus.values) {
      // `name` keeps rows cached by older builds (`underReview`) readable.
      if (v.wire == value || v.name == value) return v;
    }
    return ScholarshipApplicationStatus.unknown;
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
      case ScholarshipApplicationStatus.unknown:
        return 'Unknown';
    }
  }
}

/// Scholarship application model.
///
/// Backend rows carry `applicantId` (not `studentId`), no `programName`
/// (joined from the program catalog by the repository), `reviewNotes`, and
/// `documents` as `{documentType, fileName, fileUrl}` objects (PRC-H015).
class ScholarshipApplication {
  const ScholarshipApplication({
    required this.id,
    required this.programId,
    this.programName,
    required this.applicantId,
    required this.status,
    this.submittedAt,
    this.reviewedAt,
    this.reviewerNotes,
    this.documents = const <String>[],
  });

  final String id;
  final String programId;
  final String? programName;
  final String applicantId;
  final ScholarshipApplicationStatus status;
  final String? submittedAt;
  final String? reviewedAt;
  final String? reviewerNotes;
  final List<String> documents;

  /// Program name for display, falling back to the id when the catalog join
  /// found nothing.
  String get displayProgramName =>
      (programName != null && programName!.isNotEmpty)
      ? programName!
      : programId;

  ScholarshipApplication withProgramName(String? name) =>
      ScholarshipApplication(
        id: id,
        programId: programId,
        programName: name ?? programName,
        applicantId: applicantId,
        status: status,
        submittedAt: submittedAt,
        reviewedAt: reviewedAt,
        reviewerNotes: reviewerNotes,
        documents: documents,
      );

  factory ScholarshipApplication.fromJson(Map<String, dynamic> json) {
    final Object? program = json['program'];
    final Object? docs = json['documents'];
    return ScholarshipApplication(
      id: json['id'] as String,
      programId: _str(json['programId']) ?? '',
      programName:
          _str(json['programName']) ??
          (program is Map ? _str(program['name']) : null),
      applicantId: _str(json['applicantId']) ?? _str(json['studentId']) ?? '',
      status: ScholarshipApplicationStatus.fromWire(_str(json['status'])),
      submittedAt: _str(json['submittedAt']),
      reviewedAt: _str(json['reviewedAt']),
      reviewerNotes: _str(json['reviewNotes']) ?? _str(json['reviewerNotes']),
      documents: docs is List
          ? docs
                .map(
                  (dynamic e) => e is String
                      ? e
                      : e is Map
                      ? _str(e['fileName']) ?? _str(e['documentType'])
                      : null,
                )
                .whereType<String>()
                .toList(growable: false)
          : const <String>[],
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'programId': programId,
    'programName': programName,
    'applicantId': applicantId,
    'status': status.toWire(),
    'submittedAt': submittedAt,
    'reviewedAt': reviewedAt,
    'reviewerNotes': reviewerNotes,
    'documents': documents,
  };
}

/// Applicant's current academic record, as entered on the form (PRC-M044).
class ScholarshipAcademicRecord {
  const ScholarshipAcademicRecord({
    required this.institutionName,
    required this.educationLevel,
  });

  final String institutionName;
  final String educationLevel;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'institutionName': institutionName,
    'educationLevel': educationLevel,
  };
}

/// Repository for scholarship programs and applications.
class ScholarshipRepository {
  ScholarshipRepository({
    required AppDatabase database,
    required TenantProvider tenantProvider,
    required Dio dio,
    CacheCrypto? cacheCrypto,
    bool Function()? isPortalSession,
  }) : _database = database,
       _isPortalSession = isPortalSession,
       _tenantProvider = tenantProvider,
       _dio = dio,
       _cacheCrypto = cacheCrypto;

  static const String _applicationsTable = 'scholarship_applications_cache';

  /// PRC-H015: parents/guardians/students hold no `scholarship.*` permission;
  /// their session uses the parent-portal routes (linked children only).
  final bool Function()? _isPortalSession;

  bool get _portal => _isPortalSession?.call() ?? false;

  /// API base for the current session's audience.
  String get _base =>
      _portal ? '/api/v1/parent-portal/scholarships' : '/api/v1/scholarships';

  /// PRC-H015: seals cached application payloads (child data) bound to
  /// `tenant|table|id`. Without it (tests) payloads stay plain JSON.
  final CacheCrypto? _cacheCrypto;
  final AppDatabase _database;
  final TenantProvider _tenantProvider;
  final Dio _dio;

  bool _lastServedFromCache = false;

  /// True when the last [getPrograms] / [getApplications] call served saved
  /// rows because the server was unreachable (PRC-M043).
  bool get lastServedFromCache => _lastServedFromCache;

  /// One program, including closed rows, or null when it is not in the catalog.
  Future<ScholarshipProgram?> findProgram(String programId) async {
    final String id = programId.trim();
    if (id.isEmpty) {
      return null;
    }
    final List<ScholarshipProgram> programs = await getPrograms(
      openOnly: false,
    );
    for (final ScholarshipProgram program in programs) {
      if (program.id == id) {
        return program;
      }
    }
    return null;
  }

  /// Fetch available scholarship programs.
  Future<List<ScholarshipProgram>> getPrograms({bool openOnly = true}) async {
    final String tenantId = _requireTenantId();

    try {
      final Response<dynamic> response = await _dio.get(
        '$_base/programs',
        // The parent route lists open programs only and takes no filter.
        queryParameters: <String, dynamic>{
          if (openOnly && !_portal) 'status': 'open',
        },
      );

      final Object? body = response.data;
      final Object? rows = body is Map ? body['data'] : null;
      final List<dynamic> data = rows is List ? rows : const <dynamic>[];
      final List<ScholarshipProgram> programs = data
          .map(
            (dynamic e) =>
                ScholarshipProgram.fromJson(e as Map<String, dynamic>),
          )
          .toList(growable: false);

      await _bestEffortCache(() => _cachePrograms(tenantId, programs));
      return programs;
    } on DioException catch (error) {
      // Only an unreachable server may fall back to cache; 401/403/4xx/5xx
      // are real answers and must surface (PRC-M043).
      if (!isOfflineError(error)) rethrow;
      final List<ScholarshipProgram> cached = await _cachedOrRethrow(
        () => _getCachedPrograms(tenantId, openOnly: openOnly),
      );
      _lastServedFromCache = true;
      return cached;
    }
  }

  /// Whether this gateway exposes scholarship document upload.
  /// A missing route is 404. The signed-download route answers 401 without a token.
  Future<bool> scholarshipDocumentUploadsAvailable() async {
    try {
      final Response<dynamic> response = await _dio.get(
        '$_base/document-downloads',
      );
      return scholarshipDocumentUploadRoutePresent(response.statusCode);
    } on DioException catch (error) {
      return scholarshipDocumentUploadRoutePresent(error.response?.statusCode);
    }
  }

  /// Name of the student's cached school, for prefilling the academic
  /// record (PRC-M044). Null when either cache lacks it.
  Future<String?> institutionNameForStudent(String studentId) async {
    final String? institutionId = await institutionIdForStudent(studentId);
    if (institutionId == null) return null;
    final Database db = await _database.database;
    final List<Map<String, Object?>> rows = await db.query(
      'institutions_cache',
      columns: <String>['name'],
      where: 'tenant_id = ? AND id = ?',
      whereArgs: <Object>[_requireTenantId(), institutionId],
      limit: 1,
    );
    final Object? name = rows.isEmpty ? null : rows.first['name'];
    return name is String && name.trim().isNotEmpty ? name.trim() : null;
  }

  /// School id cached for this student, when the student list has been synced.
  Future<String?> institutionIdForStudent(String studentId) async {
    final String tenantId = _requireTenantId();
    final Database db = await _database.database;
    final List<Map<String, Object?>> rows = await db.query(
      'students_cache',
      columns: <String>['institution_id'],
      where: 'tenant_id = ? AND id = ?',
      whereArgs: <Object>[tenantId, studentId],
      limit: 1,
    );
    if (rows.isEmpty) {
      return null;
    }
    final Object? value = rows.first['institution_id'];
    if (value is String && value.trim().isNotEmpty) {
      return value.trim();
    }
    return null;
  }

  /// Draft application so files can be uploaded before required-doc checks.
  Future<String> createDraftApplication({
    required String programId,
    required String studentId,
    required String institutionId,
    required ScholarshipAcademicRecord academicRecord,
    String? personalStatement,
    double? familyIncome,
  }) async {
    final Response<dynamic> response = await _dio.post(
      '$_base/applications',
      data: <String, dynamic>{
        'programId': programId,
        'applicantId': studentId,
        'institutionId': institutionId,
        // Real values from the form; never a placeholder (PRC-M044).
        'academicRecords': <Map<String, dynamic>>[academicRecord.toJson()],
        'financialInfo': <String, dynamic>{'familyIncome': ?familyIncome},
        'documents': <Map<String, dynamic>>[],
        'asDraft': true,
        'personalStatement': ?personalStatement,
      },
    );
    return _applicationIdFromResponse(response.data);
  }

  /// Sync the latest form values into a draft before finalize (PRC-M044):
  /// `PUT /scholarships/applications/:id` (PRC-H031 on the backend).
  Future<void> updateDraftApplication({
    required String applicationId,
    required ScholarshipAcademicRecord academicRecord,
    String? personalStatement,
    double? familyIncome,
  }) async {
    await _dio.put(
      '$_base/applications/$applicationId',
      data: <String, dynamic>{
        'academicRecords': <Map<String, dynamic>>[academicRecord.toJson()],
        'financialInfo': <String, dynamic>{'familyIncome': ?familyIncome},
        'personalStatement': ?personalStatement,
      },
    );
  }

  /// Multipart upload of one supporting document. [onSendProgress] is byte counts.
  Future<void> uploadApplicationDocument({
    required String applicationId,
    required String documentType,
    required List<int> bytes,
    required String filename,
    required String mimeType,
    void Function(int sent, int total)? onSendProgress,
  }) async {
    final FormData form = FormData.fromMap(<String, dynamic>{
      'documentType': documentType,
      'file': MultipartFile.fromBytes(
        bytes,
        filename: filename,
        contentType: MediaType.parse(mimeType),
      ),
    });
    await _dio.post(
      '$_base/applications/$applicationId/documents',
      data: form,
      onSendProgress: onSendProgress,
    );
  }

  /// Finalize a draft after required documents are on the application.
  Future<void> finalizeApplication(String applicationId) async {
    await _dio.post('$_base/applications/$applicationId/submit');
  }

  /// Submit a scholarship application.
  Future<ScholarshipApplication> submitApplication({
    required String programId,
    required String studentId,
    Map<String, dynamic>? additionalData,
    List<String>? documentIds,
  }) async {
    final Response<dynamic> response = await _dio.post(
      '$_base/applications',
      data: <String, dynamic>{
        'programId': programId,
        // Backend CreateApplicationSchema field (PRC-H015).
        'applicantId': studentId,
        ...?additionalData,
        'documents': ?documentIds,
      },
    );

    final Object? body = response.data;
    final Object? row = body is Map && body['data'] is Map
        ? body['data']
        : body;
    return ScholarshipApplication.fromJson(
      Map<String, dynamic>.from(row! as Map),
    );
  }

  /// Fetch applications for a student.
  Future<List<ScholarshipApplication>> getApplications({
    required String studentId,
  }) async {
    final String tenantId = _requireTenantId();

    try {
      // The staff route filters on `applicantId`; an unknown `studentId`
      // query was ignored and listed the whole tenant (PRC-H015).
      final Response<dynamic> response = await _dio.get(
        '$_base/applications',
        // The parent route is already limited to the caller's linked
        // children; staff filter by applicant.
        queryParameters: <String, dynamic>{
          if (!_portal) 'applicantId': studentId,
        },
      );

      final Object? body = response.data;
      final Object? rows = body is Map ? body['data'] : null;
      final List<dynamic> data = rows is List ? rows : const <dynamic>[];
      // Defence in depth: never show another applicant's rows under this
      // student even if the server ignores the filter.
      final List<ScholarshipApplication> parsed = data
          .whereType<Map<String, dynamic>>()
          .map(ScholarshipApplication.fromJson)
          .where((ScholarshipApplication a) => a.applicantId == studentId)
          .toList(growable: false);
      final List<ScholarshipApplication> applications = await _withProgramNames(
        tenantId,
        parsed,
      );

      await _bestEffortCache(
        () => _cacheApplications(tenantId, studentId, applications),
      );
      return applications;
    } on DioException catch (error) {
      if (!isOfflineError(error)) rethrow;
      final List<ScholarshipApplication> cached = await _cachedOrRethrow(
        () => _getCachedApplications(tenantId, studentId),
      );
      _lastServedFromCache = true;
      return cached;
    }
  }

  /// The `scholarship_*_cache` tables exist since the v9 client migration
  /// (PRC-H015); a cache write failure (disk full, locked DB) must still never
  /// turn a successful fetch into an error.
  Future<void> _bestEffortCache(Future<void> Function() write) async {
    try {
      await write();
    } on DatabaseException {
      // Offline cache unavailable; live data is still returned.
    }
  }

  /// Offline fallback; when the cache is unavailable surface the original
  /// network error instead of an empty (misleading) list.
  Future<List<T>> _cachedOrRethrow<T>(Future<List<T>> Function() read) async {
    try {
      return await read();
    } on DatabaseException {
      throw StateError('Scholarships are not available offline yet.');
    }
  }

  /// Backend application rows have no program name; join it from the
  /// program catalog (cached copy first, then network).
  Future<List<ScholarshipApplication>> _withProgramNames(
    String tenantId,
    List<ScholarshipApplication> applications,
  ) async {
    if (applications.every(
      (ScholarshipApplication a) => a.programName != null,
    )) {
      return applications;
    }
    List<ScholarshipProgram> programs;
    try {
      programs = await _getCachedPrograms(tenantId, openOnly: false);
    } on DatabaseException {
      programs = const <ScholarshipProgram>[];
    }
    final Set<String> known = programs
        .map((ScholarshipProgram p) => p.id)
        .toSet();
    if (applications.any(
      (ScholarshipApplication a) => !known.contains(a.programId),
    )) {
      programs = await getPrograms(openOnly: false);
    }
    final Map<String, String> names = <String, String>{
      for (final ScholarshipProgram p in programs) p.id: p.name,
    };
    return applications
        .map(
          (ScholarshipApplication a) => a.withProgramName(names[a.programId]),
        )
        .toList(growable: false);
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

    return rows
        .map((Map<String, Object?> row) {
          final Map<String, dynamic> json =
              jsonDecode(row['payload'] as String) as Map<String, dynamic>;
          return ScholarshipProgram.fromJson(json);
        })
        .toList(growable: false);
  }

  Future<void> _cacheApplications(
    String tenantId,
    String studentId,
    List<ScholarshipApplication> applications,
  ) async {
    // Seal before the transaction (crypto is async and must not hold it).
    final Map<String, String> sealed = <String, String>{};
    final CacheCrypto? crypto = _cacheCrypto;
    if (crypto != null) {
      for (final ScholarshipApplication app in applications) {
        sealed[app.id] = await crypto.encrypt(
          jsonEncode(app.toJson()),
          context: CacheCrypto.rowContext(
            tenantId: tenantId,
            table: _applicationsTable,
            id: app.id,
          ),
        );
      }
    }
    final Database db = await _database.database;
    await db.transaction((Transaction txn) async {
      await txn.delete(
        _applicationsTable,
        where: 'tenant_id = ? AND student_id = ?',
        whereArgs: <Object>[tenantId, studentId],
      );
      for (final ScholarshipApplication app in applications) {
        await txn.insert(_applicationsTable, <String, Object?>{
          'id': app.id,
          'tenant_id': tenantId,
          'student_id': app.applicantId,
          'program_id': app.programId,
          'status': app.status.toWire(),
          'payload': sealed[app.id] ?? jsonEncode(app.toJson()),
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
      _applicationsTable,
      where: 'tenant_id = ? AND student_id = ?',
      whereArgs: <Object>[tenantId, studentId],
    );
    final CacheCrypto? crypto = _cacheCrypto;
    final List<ScholarshipApplication> out = <ScholarshipApplication>[];
    for (final Map<String, Object?> row in rows) {
      String payload = row['payload'] as String;
      if (crypto != null) {
        // PRC-H015: only row-bound ciphertext is trusted; plaintext or a row
        // copied from another tenant/id is skipped, never surfaced.
        if (!payload.startsWith(CacheCrypto.contextCipherPrefix)) {
          continue;
        }
        try {
          payload = await crypto.decrypt(
            payload,
            context: CacheCrypto.rowContext(
              tenantId: tenantId,
              table: _applicationsTable,
              id: row['id'] as String,
            ),
          );
        } catch (_) {
          continue;
        }
      }
      out.add(
        ScholarshipApplication.fromJson(
          jsonDecode(payload) as Map<String, dynamic>,
        ),
      );
    }
    return List<ScholarshipApplication>.unmodifiable(out);
  }

  String _applicationIdFromResponse(Object? data) {
    if (data is Map && data['id'] is String) {
      return data['id'] as String;
    }
    final Object? inner = data is Map ? data['data'] : null;
    if (inner is Map && inner['id'] is String) {
      return inner['id'] as String;
    }
    throw StateError('The draft application did not return an id.');
  }

  String _requireTenantId() {
    final String? tenantId = _tenantProvider.tenantId;
    if (tenantId == null || tenantId.isEmpty) {
      throw StateError('No active tenant for scholarship repository.');
    }
    return tenantId;
  }
}
