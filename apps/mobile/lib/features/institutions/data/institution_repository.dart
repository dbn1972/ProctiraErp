import 'dart:convert';

import 'package:openemis_api_client/openemis_api_client.dart';
import 'package:sqflite/sqflite.dart';

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
      } catch (_) {/* ignore */}
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
  })  : _database = database,
        _tenantProvider = tenantProvider,
        _api = api,
        _now = now;

  static DateTime _defaultNow() => DateTime.now();

  final AppDatabase _database;
  final TenantProvider _tenantProvider;
  final InstitutionApi? _api;
  final DateTime Function() _now;

  Future<List<CachedInstitution>> list({String? tenantId}) async {
    final Database db = await _database.database;
    final String? scope = tenantId ?? _tenantProvider.tenantId;
    final List<Map<String, Object?>> rows = await db.query(
      'institutions_cache',
      where: scope == null ? null : 'tenant_id = ?',
      whereArgs: scope == null ? null : <Object>[scope],
      orderBy: 'name ASC',
    );
    return rows.map(CachedInstitution.fromDb).toList(growable: false);
  }

  /// Cache-first lookup. When the cache misses and an API client + tenant
  /// are available, the institution is fetched from the backend, written to
  /// the cache, and returned. Network errors are swallowed so the caller
  /// receives `null` rather than crashing.
  Future<CachedInstitution?> findById(String id, {String? tenantId}) async {
    final CachedInstitution? cached =
        await _readById(id, tenantId: tenantId);
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

  Future<CachedInstitution?> _readById(
    String id, {
    String? tenantId,
  }) async {
    final Database db = await _database.database;
    final String? scope = tenantId ?? _tenantProvider.tenantId;
    final List<Map<String, Object?>> rows = await db.query(
      'institutions_cache',
      where: scope == null ? 'id = ?' : 'tenant_id = ? AND id = ?',
      whereArgs: scope == null ? <Object>[id] : <Object>[scope, id],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return CachedInstitution.fromDb(rows.first);
  }

  Future<void> upsert(Institution institution) async {
    final Database db = await _database.database;
    final String? tenantId = _tenantProvider.tenantId;
    if (tenantId == null) return;
    await db.insert(
      'institutions_cache',
      <String, Object?>{
        'id': institution.id,
        'tenant_id': tenantId,
        'name': institution.name,
        'code': institution.code,
        'area_id': institution.areaId,
        'type': institution.type,
        'sector': institution.sector,
        'ownership': institution.ownership,
        'status': institution.status,
        'payload': jsonEncode(<String, dynamic>{
          'id': institution.id,
          'name': institution.name,
          'code': institution.code,
          'areaId': institution.areaId,
          'type': institution.type,
          'sector': institution.sector,
          'ownership': institution.ownership,
          'status': institution.status,
          'createdAt': institution.createdAt,
          'updatedAt': institution.updatedAt,
        }),
        'updated_at': _now().millisecondsSinceEpoch,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }
}
