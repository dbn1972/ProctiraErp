import 'dart:convert';

import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:sqflite/sqflite.dart';

import '../../../core/storage/database.dart';
import '../../../core/tenant/tenant_provider.dart';

/// In-memory representation of a row in `notifications_cache`.
class CachedNotification {
  const CachedNotification({
    required this.id,
    required this.tenantId,
    required this.type,
    required this.title,
    required this.body,
    required this.payload,
    required this.receivedAt,
    required this.read,
  });

  final String id;
  final String? tenantId;
  final String? type;
  final String? title;
  final String? body;
  final Map<String, dynamic> payload;
  final int receivedAt;
  final bool read;

  factory CachedNotification.fromDb(Map<String, Object?> row) {
    final String? rawPayload = row['payload'] as String?;
    Map<String, dynamic> decoded = const <String, dynamic>{};
    if (rawPayload != null && rawPayload.isNotEmpty) {
      try {
        final dynamic v = jsonDecode(rawPayload);
        if (v is Map) {
          decoded = Map<String, dynamic>.from(v);
        }
      } catch (_) {
        /* ignore malformed cached payloads */
      }
    }
    return CachedNotification(
      id: row['id'] as String,
      tenantId: row['tenant_id'] as String?,
      type: row['type'] as String?,
      title: row['title'] as String?,
      body: row['body'] as String?,
      payload: decoded,
      receivedAt: (row['received_at'] as num?)?.toInt() ?? 0,
      read: ((row['read'] as num?)?.toInt() ?? 0) == 1,
    );
  }
}

/// Persistence layer for cached notifications. Backed by the
/// `notifications_cache` SQLite table introduced in schema v4.
///
/// Rows are scoped to the active tenant via [TenantProvider]; callers can
/// override the scope (mostly for tests) by passing `tenantId` explicitly.
class NotificationRepository {
  NotificationRepository({
    required AppDatabase database,
    required TenantProvider tenantProvider,
    DateTime Function() now = _defaultNow,
  }) : _database = database,
       _tenantProvider = tenantProvider,
       _now = now;

  static DateTime _defaultNow() => DateTime.now();

  final AppDatabase _database;
  final TenantProvider _tenantProvider;
  final DateTime Function() _now;

  /// Insert (or replace) a notification by id. Returns the row id supplied
  /// by the caller.
  Future<String> insert({
    required String id,
    String? tenantId,
    String? type,
    String? title,
    String? body,
    Map<String, dynamic>? payload,
    int? receivedAt,
    bool read = false,
  }) async {
    final Database db = await _database.database;
    final int ts = receivedAt ?? _now().millisecondsSinceEpoch;
    await db.transaction((Transaction txn) async {
      await _upsertPreservingRead(txn, <String, Object?>{
        'id': id,
        'tenant_id': tenantId ?? _tenantProvider.tenantId,
        'type': type,
        'title': title,
        'body': body,
        'payload': payload == null ? null : jsonEncode(payload),
        'received_at': ts,
        'read': read ? 1 : 0,
      });
    });
    return id;
  }

  /// Upsert that never clears a local read flag: once the user has read a
  /// notification, a re-delivery or inbox refresh keeps it read (PRC-L014).
  /// Implemented as query + insert/update so it works on SQLite builds that
  /// predate `ON CONFLICT DO UPDATE` (older Android).
  static Future<void> _upsertPreservingRead(
    DatabaseExecutor ex,
    Map<String, Object?> row,
  ) async {
    final String id = row['id']! as String;
    final List<Map<String, Object?>> existing = await ex.query(
      'notifications_cache',
      columns: <String>['read'],
      where: 'id = ?',
      whereArgs: <Object>[id],
      limit: 1,
    );
    if (existing.isEmpty) {
      await ex.insert('notifications_cache', row);
      return;
    }
    final bool wasRead = (existing.first['read'] as int? ?? 0) == 1;
    final Map<String, Object?> update = Map<String, Object?>.from(row)
      ..remove('id');
    if (wasRead) {
      update['read'] = 1;
    }
    await ex.update(
      'notifications_cache',
      update,
      where: 'id = ?',
      whereArgs: <Object>[id],
    );
  }

  /// Deterministic content id for payloads without a server/message id.
  /// `Map.hashCode` is identity-based, so the same payload delivered twice
  /// used to create two rows; this hashes canonical (key-sorted) JSON with
  /// two 32-bit FNV-1a passes instead.
  @visibleForTesting
  static String stableContentId(Map<String, dynamic> data, {int? sentAtMs}) {
    final String canonical = '${sentAtMs ?? 0}|${jsonEncode(_canonical(data))}';
    final List<int> bytes = utf8.encode(canonical);
    int fnv(int seed) {
      int h = seed;
      for (final int b in bytes) {
        h ^= b;
        h = (h * 0x01000193) & 0xFFFFFFFF;
      }
      return h;
    }

    final String a = fnv(0x811C9DC5).toRadixString(16).padLeft(8, '0');
    final String b = fnv(0x050C5D1F).toRadixString(16).padLeft(8, '0');
    return 'h-$a$b';
  }

  static Object? _canonical(Object? value) {
    if (value is Map) {
      final List<String> keys =
          value.keys.map((Object? k) => k.toString()).toList()..sort();
      return <String, Object?>{
        for (final String k in keys) k: _canonical(value[k]),
      };
    }
    if (value is List) {
      return value.map(_canonical).toList();
    }
    return value;
  }

  /// List every cached notification scoped to the current tenant (most
  /// recent first). Without an active tenant nothing is returned: a null
  /// scope must never widen to every tenant's rows (PRC-M036).
  Future<List<CachedNotification>> listAll({String? tenantId}) async {
    final String? scope = _scope(tenantId);
    if (scope == null) return const <CachedNotification>[];
    final Database db = await _database.database;
    final List<Map<String, Object?>> rows = await db.query(
      'notifications_cache',
      where: 'tenant_id = ?',
      whereArgs: <Object>[scope],
      orderBy: 'received_at DESC, id ASC',
    );
    return rows.map(CachedNotification.fromDb).toList(growable: false);
  }

  /// Mark a specific notification of the current tenant as read. Returns
  /// the number of rows affected (`0` when the id is unknown, belongs to
  /// another tenant, or no tenant is active).
  Future<int> markRead(String id, {String? tenantId}) async {
    final String? scope = _scope(tenantId);
    if (scope == null) return 0;
    final Database db = await _database.database;
    return db.update(
      'notifications_cache',
      <String, Object?>{'read': 1},
      where: 'id = ? AND tenant_id = ?',
      whereArgs: <Object>[id, scope],
    );
  }

  /// Mark every cached notification (within the current tenant) as read.
  Future<int> markAllRead({String? tenantId}) async {
    final String? scope = _scope(tenantId);
    if (scope == null) return 0;
    final Database db = await _database.database;
    return db.update(
      'notifications_cache',
      <String, Object?>{'read': 1},
      where: 'tenant_id = ?',
      whereArgs: <Object>[scope],
    );
  }

  /// Delete every cached notification for the current tenant. Returns the
  /// number of rows removed.
  Future<int> deleteAll({String? tenantId}) async {
    final String? scope = _scope(tenantId);
    if (scope == null) return 0;
    final Database db = await _database.database;
    return db.delete(
      'notifications_cache',
      where: 'tenant_id = ?',
      whereArgs: <Object>[scope],
    );
  }

  String? _scope(String? override) {
    final String? scope = override ?? _tenantProvider.tenantId;
    return (scope == null || scope.isEmpty) ? null : scope;
  }

  /// Persist an FCM-delivered notification. Uses `messageId` as the primary
  /// key when available, falling back to a hash of the data payload so we
  /// don't double-count messages without an explicit id.
  Future<String> upsertFromRemote(RemoteMessage message) async {
    final RemoteNotification? notification = message.notification;
    final Map<String, dynamic> data = Map<String, dynamic>.from(message.data);
    final Object? serverId = data['notificationId'] ?? data['id'];
    final String id =
        message.messageId ??
        (serverId is String && serverId.isNotEmpty
            ? serverId
            : stableContentId(
                data,
                sentAtMs: message.sentTime?.millisecondsSinceEpoch,
              ));
    return insert(
      id: id,
      type: data['type'] is String ? data['type'] as String : null,
      title: notification?.title ?? data['title'] as String?,
      body: notification?.body ?? data['body'] as String?,
      payload: data,
      receivedAt:
          message.sentTime?.millisecondsSinceEpoch ??
          _now().millisecondsSinceEpoch,
    );
  }

  /// Replace the cache with the supplied list of notifications. Used when
  /// the inbox screen pulls fresh data from the backend.
  Future<void> replaceWith(List<Map<String, dynamic>> remote) async {
    final Database db = await _database.database;
    final String? tenantId = _tenantProvider.tenantId;
    await db.transaction((Transaction txn) async {
      // Keep historical notifications around even when the server-side list
      // truncates older entries; we only upsert the latest items.
      for (final Map<String, dynamic> item in remote) {
        final String id =
            (item['id'] as String?) ??
            (item['messageId'] as String?) ??
            stableContentId(item);
        await _upsertPreservingRead(txn, <String, Object?>{
          'id': id,
          'tenant_id': tenantId,
          'type': item['type'] as String?,
          'title': item['title'] as String?,
          'body': item['body'] as String?,
          'payload': jsonEncode(item),
          'received_at':
              (item['receivedAt'] as num?)?.toInt() ??
              _now().millisecondsSinceEpoch,
          'read': item['read'] == true ? 1 : 0,
        });
      }
    });
  }
}
