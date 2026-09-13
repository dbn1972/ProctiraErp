import 'dart:convert';

import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:sqflite/sqflite.dart';

import '../../../core/storage/cache_crypto.dart';
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
///
/// Child PII in `students_cache` (`full_name`, `national_id`, `payload`) is
/// sealed with [CacheCrypto] before write (W2-MOB-01).
class StudentRepository {
  StudentRepository({
    required AppDatabase database,
    required TenantProvider tenantProvider,
    required SyncEngine syncEngine,
    required CacheCrypto cacheCrypto,
    StudentApi? studentApi,
    DateTime Function() now = _defaultNow,
  })  : _database = database,
        _tenantProvider = tenantProvider,
        _syncEngine = syncEngine,
        _cacheCrypto = cacheCrypto,
        _studentApi = studentApi,
        _now = now;

  static DateTime _defaultNow() => DateTime.now();

  final AppDatabase _database;
  final TenantProvider _tenantProvider;
  final SyncEngine _syncEngine;
  final CacheCrypto _cacheCrypto;
  final StudentApi? _studentApi;
  final DateTime Function() _now;

  /// Write one student into the encrypted offline cache (no sync enqueue).
  Future<void> cacheStudent(Student student) async {
    final String tenantId = _requireTenantId();
    final Database db = await _database.database;
    await db.insert(
      'students_cache',
      await _toCacheRow(tenantId, student),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

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

    List<CachedStudent> results =
        await _queryCache(db, tenantId, query, limit);
    if (results.isEmpty && seedFromApi && _studentApi != null) {
      try {
        final List<Student> remote =
            await _studentApi.listStudents(pageSize: limit);
        if (remote.isNotEmpty) {
          await db.transaction((Transaction txn) async {
            for (final Student s in remote) {
              await txn.insert(
                'students_cache',
                await _toCacheRow(tenantId, s),
                conflictAlgorithm: ConflictAlgorithm.replace,
              );
            }
          });
          results = await _queryCache(db, tenantId, query, limit);
        }
      } on ApiException {
        // Network failure: return whatever we have locally.
      }
    }

    return results;
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

    final CachedStudent existing = await _fromCacheRow(rows.first);
    final List<String> documents = List<String>.from(existing.documents)
      ..add(filePath);
    final Map<String, dynamic> payload = <String, dynamic>{
      ...existing.payload,
      'documents': documents,
    };

    final Map<String, Object?> updated = <String, Object?>{
      'id': existing.id,
      'tenant_id': tenantId,
      'institution_id': existing.institutionId,
      'full_name': await _cacheCrypto.encrypt(existing.fullName),
      'national_id': await _cacheCrypto.encryptNullable(existing.nationalId),
      'grade': rows.first['grade'],
      'class_name': rows.first['class_name'],
      'payload': await _cacheCrypto.encrypt(jsonEncode(payload)),
      'updated_at': _now().millisecondsSinceEpoch,
      'version': rows.first['version'],
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
      baseVersion: rows.first['version'] as String?,
    );

    return _fromCacheRow(updated);
  }

  Future<List<CachedStudent>> _queryCache(
    Database db,
    String tenantId,
    String query,
    int limit,
  ) async {
    // Sealed columns are not LIKE-searchable — decrypt then filter in memory.
    final List<Map<String, Object?>> rows = await db.query(
      'students_cache',
      where: 'tenant_id = ?',
      whereArgs: <Object>[tenantId],
    );
    final String needle = query.trim().toLowerCase();
    final List<CachedStudent> decoded = <CachedStudent>[];
    for (final Map<String, Object?> row in rows) {
      final CachedStudent student = await _fromCacheRow(row);
      if (needle.isEmpty ||
          student.fullName.toLowerCase().contains(needle) ||
          (student.nationalId?.toLowerCase().contains(needle) ?? false)) {
        decoded.add(student);
      }
    }
    decoded.sort(
      (CachedStudent a, CachedStudent b) =>
          a.fullName.toLowerCase().compareTo(b.fullName.toLowerCase()),
    );
    if (decoded.length <= limit) {
      return decoded;
    }
    return decoded.sublist(0, limit);
  }

  Future<Map<String, Object?>> _toCacheRow(String tenantId, Student s) async {
    final String payloadJson = jsonEncode(<String, dynamic>{
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
    });
    return <String, Object?>{
      'id': s.id,
      'tenant_id': tenantId,
      'institution_id': s.institutionId,
      'full_name': await _cacheCrypto.encrypt(s.fullName),
      'national_id': await _cacheCrypto.encryptNullable(s.nationalId),
      'grade': null,
      'class_name': null,
      'payload': await _cacheCrypto.encrypt(payloadJson),
      'updated_at': _now().millisecondsSinceEpoch,
      'version': s.version,
    };
  }

  Future<CachedStudent> _fromCacheRow(Map<String, Object?> row) async {
    final String payloadRaw =
        await _cacheCrypto.decrypt(row['payload'] as String);
    final Map<String, dynamic> payload =
        jsonDecode(payloadRaw) as Map<String, dynamic>;
    final List<String> docs = (payload['documents'] is List)
        ? List<String>.from((payload['documents'] as List).whereType<String>())
        : const <String>[];
    return CachedStudent(
      id: row['id'] as String,
      fullName: await _cacheCrypto.decrypt(row['full_name'] as String),
      nationalId:
          await _cacheCrypto.decryptNullable(row['national_id'] as String?),
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
