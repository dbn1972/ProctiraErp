import 'dart:convert';

import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:sqflite/sqflite.dart';

import '../../../core/storage/database.dart';
import '../../../core/sync/sync_engine.dart';
import '../../../core/sync/sync_models.dart';
import '../../../core/tenant/tenant_provider.dart';

/// Lightweight projection of a student returned from the local cache.
class CachedStudent {
  CachedStudent({
    required this.id,
    required this.fullName,
    this.nationalId,
    this.institutionId,
    this.dateOfBirth,
    this.gender,
    this.documents = const <String>[],
    this.payload = const <String, dynamic>{},
  });

  final String id;
  final String fullName;
  final String? nationalId;
  final String? institutionId;
  final String? dateOfBirth;
  final String? gender;
  final List<String> documents;
  final Map<String, dynamic> payload;
}

/// Cache-first repository for the student feature. Mirrors the design of
/// [AttendanceRepository] — the cache is consulted first; the API is only
/// invoked as a fallback to seed an empty cache.
class StudentRepository {
  StudentRepository({
    required AppDatabase database,
    required TenantProvider tenantProvider,
    required SyncEngine syncEngine,
    StudentApi? studentApi,
    DateTime Function() now = _defaultNow,
  })  : _database = database,
        _tenantProvider = tenantProvider,
        _syncEngine = syncEngine,
        _studentApi = studentApi,
        _now = now;

  static DateTime _defaultNow() => DateTime.now();

  final AppDatabase _database;
  final TenantProvider _tenantProvider;
  final SyncEngine _syncEngine;
  final StudentApi? _studentApi;
  final DateTime Function() _now;

  /// Returns up to [limit] students that match [query] on [name] / national id.
  /// When the local cache is empty AND [seedFromApi] is true, the network is
  /// queried and the rows are stored locally before returning.
  Future<List<CachedStudent>> searchStudents({
    String query = '',
    int limit = 50,
    bool seedFromApi = true,
  }) async {
    final String tenantId = _requireTenantId();
    final Database db = await _database.database;

    List<Map<String, Object?>> rows = await _queryCache(db, tenantId, query, limit);
    if (rows.isEmpty && seedFromApi && _studentApi != null) {
      try {
        final List<Student> remote =
            await _studentApi.listStudents(pageSize: limit);
        if (remote.isNotEmpty) {
          await db.transaction((Transaction txn) async {
            for (final Student s in remote) {
              await txn.insert(
                'students_cache',
                _toCacheRow(tenantId, s),
                conflictAlgorithm: ConflictAlgorithm.replace,
              );
            }
          });
          rows = await _queryCache(db, tenantId, query, limit);
        }
      } on ApiException {
        // Network failure: return whatever we have locally.
      }
    }

    return rows.map(_fromCacheRow).toList(growable: false);
  }

  Future<CachedStudent?> getStudent(String id) async {
    final String tenantId = _requireTenantId();
    final Database db = await _database.database;
    final List<Map<String, Object?>> rows = await db.query(
      'students_cache',
      where: 'tenant_id = ? AND id = ?',
      whereArgs: <Object>[tenantId, id],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return _fromCacheRow(rows.first);
  }

  /// Persist a captured document path locally and queue a `student.update`
  /// op so the sync engine can replay the upload when the device is online.
  /// The mobile app stores file paths today; a real upload pipeline will
  /// translate the path into a multi-part request server-side.
  Future<CachedStudent?> attachDocument({
    required String studentId,
    required String filePath,
  }) async {
    final String tenantId = _requireTenantId();
    final Database db = await _database.database;
    final List<Map<String, Object?>> rows = await db.query(
      'students_cache',
      where: 'tenant_id = ? AND id = ?',
      whereArgs: <Object>[tenantId, studentId],
      limit: 1,
    );
    if (rows.isEmpty) return null;

    final Map<String, Object?> row = rows.first;
    final Map<String, dynamic> payload = jsonDecode(row['payload'] as String)
        as Map<String, dynamic>;
    final List<String> documents = (payload['documents'] is List)
        ? List<String>.from(
            (payload['documents'] as List).whereType<String>(),
          )
        : <String>[];
    documents.add(filePath);
    payload['documents'] = documents;

    final Map<String, Object?> updated = <String, Object?>{
      ...row,
      'payload': jsonEncode(payload),
      'updated_at': _now().millisecondsSinceEpoch,
    };

    await _syncEngine.saveLocallyAndQueue(
      entityType: SyncEntityType.student,
      operation: SyncOperation.update,
      cacheTable: 'students_cache',
      cachePayload: updated,
      syncPayload: <String, dynamic>{
        'id': studentId,
        'documents': documents,
      },
      entityId: studentId,
      baseVersion: row['version'] as String?,
    );

    return _fromCacheRow(updated);
  }

  Future<List<Map<String, Object?>>> _queryCache(
    Database db,
    String tenantId,
    String query,
    int limit,
  ) {
    if (query.trim().isEmpty) {
      return db.query(
        'students_cache',
        where: 'tenant_id = ?',
        whereArgs: <Object>[tenantId],
        orderBy: 'full_name ASC',
        limit: limit,
      );
    }
    final String like = '%${query.trim()}%';
    return db.query(
      'students_cache',
      where: 'tenant_id = ? AND (full_name LIKE ? OR national_id LIKE ?)',
      whereArgs: <Object>[tenantId, like, like],
      orderBy: 'full_name ASC',
      limit: limit,
    );
  }

  Map<String, Object?> _toCacheRow(String tenantId, Student s) {
    return <String, Object?>{
      'id': s.id,
      'tenant_id': tenantId,
      'institution_id': s.institutionId,
      'full_name': s.fullName,
      'national_id': s.nationalId,
      'grade': null,
      'class_name': null,
      'payload': jsonEncode(<String, dynamic>{
        'id': s.id,
        'firstName': s.firstName,
        'middleName': s.middleName,
        'lastName': s.lastName,
        'nationalId': s.nationalId,
        'dateOfBirth': s.dateOfBirth,
        'gender': s.gender,
        'institutionId': s.institutionId,
        'createdAt': s.createdAt,
        'updatedAt': s.updatedAt,
      }),
      'updated_at': _now().millisecondsSinceEpoch,
      'version': s.version,
    };
  }

  CachedStudent _fromCacheRow(Map<String, Object?> row) {
    final Map<String, dynamic> payload = jsonDecode(row['payload'] as String)
        as Map<String, dynamic>;
    final List<String> docs = (payload['documents'] is List)
        ? List<String>.from((payload['documents'] as List).whereType<String>())
        : const <String>[];
    return CachedStudent(
      id: row['id'] as String,
      fullName: row['full_name'] as String,
      nationalId: row['national_id'] as String?,
      institutionId: row['institution_id'] as String?,
      dateOfBirth: payload['dateOfBirth'] as String?,
      gender: payload['gender'] as String?,
      documents: docs,
      payload: payload,
    );
  }

  String _requireTenantId() {
    final String? tenantId = _tenantProvider.tenantId;
    if (tenantId == null || tenantId.isEmpty) {
      throw StateError('Cannot use student repository without an active tenant.');
    }
    return tenantId;
  }
}
