import 'dart:convert';

import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:sqflite/sqflite.dart';

import '../api/pagination.dart';
import '../errors/offline_fallback.dart';
import '../storage/cache_crypto.dart';

/// Shared remote -> `students_cache` refresh used by the attendance roster and
/// the student directory (PRC-M031, PRC-M032, PRC-M042).
///
/// * Pages through `GET /students` until a short page is returned, so rosters
///   larger than the gateway page ceiling are complete.
/// * Writes `grade` / `class_name` so class filtering works offline.
/// * Prunes cached rows the server no longer returns (within the refreshed
///   scope) so removed students disappear after a refresh.
/// * Preserves locally attached document references kept in the payload.
class StudentCacheSync {
  StudentCacheSync({
    required CacheCrypto cacheCrypto,
    DateTime Function() now = _defaultNow,
    this.pageSize = kMaxApiPageSize,
    this.maxPages = 200,
  }) : _cacheCrypto = cacheCrypto,
       _now = now;

  static DateTime _defaultNow() => DateTime.now();

  final CacheCrypto _cacheCrypto;
  final DateTime Function() _now;
  final int pageSize;

  /// Hard stop so a misbehaving server cannot loop forever.
  final int maxPages;

  /// Fetch every page of students for [institutionId] (all when null).
  Future<List<Student>> fetchAll(
    StudentApi api, {
    String? institutionId,
  }) async {
    final List<Student> all = <Student>[];
    for (int page = 1; page <= maxPages; page++) {
      final List<Student> batch = await api.listStudents(
        page: page,
        pageSize: pageSize,
        institutionId: institutionId,
      );
      all.addAll(batch);
      if (batch.length < pageSize) break;
    }
    return all;
  }

  /// Replace the cached rows in scope ([tenantId] + optional
  /// [institutionId]) with [remote]. Returns the number of pruned rows.
  Future<int> replaceScope(
    Database db, {
    required String tenantId,
    String? institutionId,
    required List<Student> remote,
  }) async {
    final String scopeWhere = institutionId == null
        ? 'tenant_id = ?'
        : 'tenant_id = ? AND institution_id = ?';
    final List<Object> scopeArgs = institutionId == null
        ? <Object>[tenantId]
        : <Object>[tenantId, institutionId];
    int pruned = 0;
    await db.transaction((Transaction txn) async {
      final List<Map<String, Object?>> existingRows = await txn.query(
        'students_cache',
        columns: <String>['id', 'payload'],
        where: scopeWhere,
        whereArgs: scopeArgs,
      );
      final Map<String, String?> existingPayload = <String, String?>{
        for (final Map<String, Object?> row in existingRows)
          row['id']! as String: row['payload'] as String?,
      };
      final Set<String> seen = <String>{};
      for (final Student student in remote) {
        seen.add(student.id);
        await txn.insert(
          'students_cache',
          await cacheRow(
            tenantId,
            student,
            existingSealedPayload: existingPayload[student.id],
          ),
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
      for (final String id in existingPayload.keys) {
        if (!seen.contains(id)) {
          pruned += await txn.delete(
            'students_cache',
            where: 'tenant_id = ? AND id = ?',
            whereArgs: <Object>[tenantId, id],
          );
        }
      }
    });
    return pruned;
  }

  /// Build an encrypted `students_cache` row for [student].
  Future<Map<String, Object?>> cacheRow(
    String tenantId,
    Student student, {
    String? existingSealedPayload,
  }) async {
    List<Object?>? documents;
    if (existingSealedPayload != null) {
      try {
        final Object? old = jsonDecode(
          await _cacheCrypto.decrypt(existingSealedPayload),
        );
        if (old is Map && old['documents'] is List) {
          documents = List<Object?>.from(old['documents'] as List);
        }
      } on Object {
        // Unreadable legacy payload: drop it, the server copy wins.
      }
    }
    final String payload = jsonEncode(<String, dynamic>{
      'id': student.id,
      'firstName': student.firstName,
      'middleName': student.middleName,
      'lastName': student.lastName,
      'nationalId': student.nationalId,
      'dateOfBirth': student.dateOfBirth,
      'gender': student.gender,
      'institutionId': student.institutionId,
      'className': student.className,
      'grade': student.grade,
      'createdAt': student.createdAt,
      'updatedAt': student.updatedAt,
      'documents': ?documents,
    });
    return <String, Object?>{
      'id': student.id,
      'tenant_id': tenantId,
      'institution_id': student.institutionId,
      'full_name': await _cacheCrypto.encrypt(student.fullName),
      'national_id': await _cacheCrypto.encryptNullable(student.nationalId),
      'grade': student.grade,
      'class_name': student.className,
      'payload': await _cacheCrypto.encrypt(payload),
      'updated_at': _now().millisecondsSinceEpoch,
      'version': student.version,
    };
  }
}

/// True when [error] means "could not reach the server" (offline, timeout),
/// as opposed to an authorisation or validation rejection that must surface.
bool isConnectivityFailure(Object error) => isOfflineError(error);
