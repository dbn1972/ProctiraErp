import 'dart:convert';

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
        if (v is Map<String, dynamic>) decoded = v;
      } catch (_) {/* ignore malformed cached payloads */}
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
  })  : _database = database,
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
    await db.insert(
      'notifications_cache',
      <String, Object?>{
        'id': id,
        'tenant_id': tenantId ?? _tenantProvider.tenantId,
        'type': type,
        'title': title,
        'body': body,
        'payload': payload == null ? null : jsonEncode(payload),
        'received_at': ts,
        'read': read ? 1 : 0,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
    return id;
  }

  /// List every cached notification scoped to the current tenant (most
  /// recent first).
  Future<List<CachedNotification>> listAll({String? tenantId}) async {
    final Database db = await _database.database;
    final String? scope = tenantId ?? _tenantProvider.tenantId;
    final List<Map<String, Object?>> rows = await db.query(
      'notifications_cache',
      where: scope == null ? null : 'tenant_id = ?',
      whereArgs: scope == null ? null : <Object>[scope],
      orderBy: 'received_at DESC, id ASC',
    );
    return rows.map(CachedNotification.fromDb).toList(growable: false);
  }

  /// Mark a specific notification as read. Returns the number of rows
  /// affected (`0` when the id is unknown).
  Future<int> markRead(String id) async {
    final Database db = await _database.database;
    return db.update(
      'notifications_cache',
      <String, Object?>{'read': 1},
      where: 'id = ?',
      whereArgs: <Object>[id],
    );
  }

  /// Mark every cached notification (within the current tenant) as read.
  Future<int> markAllRead({String? tenantId}) async {
    final Database db = await _database.database;
    final String? scope = tenantId ?? _tenantProvider.tenantId;
    return db.update(
      'notifications_cache',
      <String, Object?>{'read': 1},
      where: scope == null ? null : 'tenant_id = ?',
      whereArgs: scope == null ? null : <Object>[scope],
    );
  }

  /// Delete every cached notification for the current tenant. Returns the
  /// number of rows removed.
  Future<int> deleteAll({String? tenantId}) async {
    final Database db = await _database.database;
    final String? scope = tenantId ?? _tenantProvider.tenantId;
    return db.delete(
      'notifications_cache',
      where: scope == null ? null : 'tenant_id = ?',
      whereArgs: scope == null ? null : <Object>[scope],
    );
  }

  /// Persist an FCM-delivered notification. Uses `messageId` as the primary
  /// key when available, falling back to a hash of the data payload so we
  /// don't double-count messages without an explicit id.
  Future<String> upsertFromRemote(RemoteMessage message) async {
    final RemoteNotification? notification = message.notification;
    final Map<String, dynamic> data =
        Map<String, dynamic>.from(message.data);
    final String id = message.messageId ??
        '${message.sentTime?.millisecondsSinceEpoch ?? 0}-${data.hashCode}';
    return insert(
      id: id,
      type: data['type'] is String ? data['type'] as String : null,
      title: notification?.title ?? data['title'] as String?,
      body: notification?.body ?? data['body'] as String?,
      payload: data,
      receivedAt: message.sentTime?.millisecondsSinceEpoch ??
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
        final String id = (item['id'] as String?) ??
            (item['messageId'] as String?) ??
            item.toString();
        await txn.insert(
          'notifications_cache',
          <String, Object?>{
            'id': id,
            'tenant_id': tenantId,
            'type': item['type'] as String?,
            'title': item['title'] as String?,
            'body': item['body'] as String?,
            'payload': jsonEncode(item),
            'received_at': (item['receivedAt'] as num?)?.toInt() ??
                _now().millisecondsSinceEpoch,
            'read': item['read'] == true ? 1 : 0,
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
    });
  }
}
