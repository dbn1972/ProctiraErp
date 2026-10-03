import 'dart:convert';

import 'package:proctira_api_client/proctira_api_client.dart';
import 'package:sqflite/sqflite.dart';

import '../../../core/api/pagination.dart';

import '../../../core/storage/database.dart';
import '../../../core/tenant/tenant_provider.dart';

/// Cached institution row used to back the `/institutions` list when the
/// device is offline. Fields mirror [Institution] with the addition of an
/// `updated_at` timestamp.
class CachedInstitution {
  const CachedInstitution({
    required this.id,
    required this.tenantId,
    required this.name,
    required this.code,
    this.areaId,
    this.type,
    this.sector,
    this.ownership,
    this.status,
    required this.payload,
    required this.updatedAt,
  });

  final String id;
  final String tenantId;
  final String name;
  final String? code;
  final String? areaId;
  final String? type;
  final String? sector;
  final String? ownership;
  final String? status;
  final Map<String, dynamic> payload;
  final int updatedAt;

  factory CachedInstitution.fromDb(Map<String, Object?> row) {
    Map<String, dynamic> decoded = const <String, dynamic>{};
    final String? raw = row['payload'] as String?;
    if (raw != null && raw.isNotEmpty) {
      try {
        final dynamic v = jsonDecode(raw);
        if (v is Map<String, dynamic>) decoded = v;
      } catch (_) {
        /* ignore */
      }
    }
    return CachedInstitution(
      id: row['id'] as String,
      tenantId: row['tenant_id'] as String,
      name: row['name'] as String,
      code: row['code'] as String?,
      areaId: row['area_id'] as String?,
      type: row['type'] as String?,
      sector: row['sector'] as String?,
      ownership: row['ownership'] as String?,
      status: row['status'] as String?,
      payload: decoded,
      updatedAt: (row['updated_at'] as num?)?.toInt() ?? 0,
    );
  }
}

/// Cache-first read/write access to the local `institutions_cache` table.
///
/// `findById` falls back to the network ([InstitutionApi.fetchInstitution])
/// when the cache is empty for the requested institution and seeds the row
/// before returning it.
class InstitutionRepository {
  InstitutionRepository({
    required AppDatabase database,
    required TenantProvider tenantProvider,
    InstitutionApi? api,
    DateTime Function() now = _defaultNow,
  }) : _database = database,
       _tenantProvider = tenantProvider,
       _api = api,
       _now = now;

  static DateTime _defaultNow() => DateTime.now();

  final AppDatabase _database;
  final TenantProvider _tenantProvider;
  final InstitutionApi? _api;
  final DateTime Function() _now;

  /// Cached institutions of the active tenant. Without a tenant nothing is
  /// returned; a null scope never widens to all tenants (PRC-M036).
  Future<List<CachedInstitution>> list({String? tenantId}) async {
    final String? scope = _scope(tenantId);
    if (scope == null) return const <CachedInstitution>[];
    final Database db = await _database.database;
    final List<Map<String, Object?>> rows = await db.query(
      'institutions_cache',
      where: 'tenant_id = ?',
      whereArgs: <Object>[scope],
      orderBy: 'name ASC',
    );
    return rows.map(CachedInstitution.fromDb).toList(growable: false);
  }

  /// Cache-first lookup. When the cache misses and an API client + tenant
  /// are available, the institution is fetched from the backend, written to
  /// the cache, and returned. Network errors are swallowed so the caller
  /// receives `null` rather than crashing.
  Future<CachedInstitution?> findById(String id, {String? tenantId}) async {
    final CachedInstitution? cached = await _readById(id, tenantId: tenantId);
    if (cached != null) return cached;

    final InstitutionApi? api = _api;
    if (api == null) return null;
    if ((tenantId ?? _tenantProvider.tenantId) == null) return null;

    try {
      final Institution institution = await api.fetchInstitution(id);
      await upsert(institution);
    } catch (_) {
      return null;
    }
    return _readById(id, tenantId: tenantId);
  }

  Future<CachedInstitution?> _readById(String id, {String? tenantId}) async {
    final String? scope = _scope(tenantId);
    if (scope == null) return null;
    final Database db = await _database.database;
    final List<Map<String, Object?>> rows = await db.query(
      'institutions_cache',
      where: 'tenant_id = ? AND id = ?',
      whereArgs: <Object>[scope, id],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return CachedInstitution.fromDb(rows.first);
  }

  String? _scope(String? override) {
    final String? scope = override ?? _tenantProvider.tenantId;
    return (scope == null || scope.isEmpty) ? null : scope;
  }

  /// Page through the institutions list until exhausted and replace this
  /// tenant's cache with the result (PRC-M037). Throws on API failure so the
  /// screen can show an error with retry instead of an empty state.
  Future<int> refreshAll({
    int pageSize = kMaxApiPageSize,
    int maxPages = 50,
  }) async {
    final InstitutionApi? api = _api;
    final String? tenantId = _scope(null);
    if (api == null || tenantId == null) return 0;
    final List<Institution> all = <Institution>[];
    for (int page = 1; page <= maxPages; page++) {
      final List<Institution> batch = await api.listInstitutions(
        page: page,
        pageSize: pageSize,
      );
      all.addAll(batch);
      if (batch.length < pageSize) break;
    }
    final Database db = await _database.database;
    await db.transaction((Transaction txn) async {
      await txn.delete(
        'institutions_cache',
        where: 'tenant_id = ?',
        whereArgs: <Object>[tenantId],
      );
      for (final Institution i in all) {
        await txn.insert(
          'institutions_cache',
          _row(tenantId, i),
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
    });
    return all.length;
  }

  Future<void> upsert(Institution institution) async {
    final Database db = await _database.database;
    final String? tenantId = _tenantProvider.tenantId;
    if (tenantId == null) return;
    await db.insert(
      'institutions_cache',
      _row(tenantId, institution),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Map<String, Object?> _row(String tenantId, Institution i) =>
      <String, Object?>{
        'id': i.id,
        'tenant_id': tenantId,
        'name': i.name,
        'code': i.code,
        'area_id': i.areaId,
        'type': i.type,
        'sector': i.sector,
        'ownership': i.ownership,
        'status': i.status,
        'payload': jsonEncode(<String, dynamic>{
          'id': i.id,
          'name': i.name,
          'code': i.code,
          'areaId': i.areaId,
          'type': i.type,
          'sector': i.sector,
          'ownership': i.ownership,
          'status': i.status,
          'createdAt': i.createdAt,
          'updatedAt': i.updatedAt,
        }),
        'updated_at': _now().millisecondsSinceEpoch,
      };
}
