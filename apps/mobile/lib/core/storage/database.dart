import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

/// Local SQLite database used for offline caching and pending sync operations.
///
/// Schema is versioned with migrations applied via [_onUpgrade]. Each tenant
/// shares the same physical file but rows include a `tenant_id` column so we
/// can scope queries when multiple tenants are configured on the device.
class AppDatabase {
  AppDatabase({String? overridePath}) : _overridePath = overridePath;

  static const int schemaVersion = 5;
  static const String _dbFileName = 'openemis_mobile.db';

  final String? _overridePath;
  Database? _db;

  Future<Database> get database async {
    return _db ??= await _open();
  }

  Future<Database> _open() async {
    String path;
    final String? overridePath = _overridePath;
    if (overridePath != null) {
      path = overridePath;
    } else {
      final String dir = (await getApplicationDocumentsDirectory()).path;
      path = p.join(dir, _dbFileName);
    }
    return openDatabase(
      path,
      version: schemaVersion,
      onCreate: (Database db, int version) async {
        await _applyMigrations(db, fromVersion: 0, toVersion: version);
      },
      onUpgrade: (Database db, int oldVersion, int newVersion) async {
        await _applyMigrations(db, fromVersion: oldVersion, toVersion: newVersion);
      },
    );
  }

  Future<void> _applyMigrations(
    Database db, {
    required int fromVersion,
    required int toVersion,
  }) async {
    if (fromVersion < 1 && toVersion >= 1) {
      await db.execute('''
        CREATE TABLE IF NOT EXISTS pending_sync (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT,
          operation TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_attempt_at INTEGER,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT
        )
      ''');
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_pending_sync_tenant ON pending_sync(tenant_id)',
      );

      await db.execute('''
        CREATE TABLE IF NOT EXISTS attendance_offline (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          institution_id TEXT NOT NULL,
          class_id TEXT,
          subject_id TEXT,
          student_id TEXT NOT NULL,
          attendance_date TEXT NOT NULL,
          status TEXT NOT NULL,
          remarks TEXT,
          recorded_at INTEGER NOT NULL,
          synced INTEGER NOT NULL DEFAULT 0
        )
      ''');
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_attendance_offline_unsynced '
        'ON attendance_offline(tenant_id, synced)',
      );

      await db.execute('''
        CREATE TABLE IF NOT EXISTS students_cache (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          institution_id TEXT,
          full_name TEXT NOT NULL,
          national_id TEXT,
          grade TEXT,
          class_name TEXT,
          payload TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (tenant_id, id)
        )
      ''');
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_students_cache_institution '
        'ON students_cache(tenant_id, institution_id)',
      );
    }
    if (fromVersion < 2 && toVersion >= 2) {
      // Track the server `version` (updatedAt) on every queued op so the
      // sync engine can send `If-Match` and surface 409 conflicts.
      await db.execute(
        'ALTER TABLE pending_sync ADD COLUMN base_version TEXT',
      );
      await db.execute(
        "ALTER TABLE pending_sync ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'",
      );
      await db.execute(
        'ALTER TABLE attendance_offline ADD COLUMN version TEXT',
      );
      await db.execute(
        'ALTER TABLE students_cache ADD COLUMN version TEXT',
      );

      // Conflicted rows the user must reconcile manually. Stored separately
      // so the queue can keep draining unrelated work without blocking on a
      // single bad row.
      await db.execute('''
        CREATE TABLE IF NOT EXISTS sync_conflicts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          operation TEXT NOT NULL,
          local_payload TEXT NOT NULL,
          server_payload TEXT,
          base_version TEXT,
          server_version TEXT,
          detected_at INTEGER NOT NULL
        )
      ''');
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_sync_conflicts_tenant '
        'ON sync_conflicts(tenant_id)',
      );
    }
    if (fromVersion < 4 && toVersion >= 4) {
      // v3/v4 are folded together: notifications cache + institutions cache.
      // Versioning bumped straight to 4 because subsequent feature work also
      // lands in the same migration window — keeping a single combined step
      // avoids rerunning ALTERs on already-installed dev devices.
      await db.execute('''
        CREATE TABLE IF NOT EXISTS notifications_cache (
          id TEXT PRIMARY KEY,
          tenant_id TEXT,
          type TEXT,
          title TEXT,
          body TEXT,
          payload TEXT,
          received_at INTEGER,
          read INTEGER DEFAULT 0
        )
      ''');
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_notifications_cache_tenant '
        'ON notifications_cache(tenant_id, received_at)',
      );

      await db.execute('''
        CREATE TABLE IF NOT EXISTS institutions_cache (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          name TEXT NOT NULL,
          code TEXT,
          area_id TEXT,
          type TEXT,
          sector TEXT,
          ownership TEXT,
          status TEXT,
          payload TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (tenant_id, id)
        )
      ''');
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_institutions_cache_tenant '
        'ON institutions_cache(tenant_id)',
      );
    }
    if (fromVersion < 5 && toVersion >= 5) {
      // v5 adds the enrollments cache (read-only mirror of the backend
      // `student_enrollment_history` table) and the lat/lon columns the
      // attendance geofence widget reads from `institutions_cache`.
      await db.execute('''
        CREATE TABLE IF NOT EXISTS enrollments_cache (
          id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          student_id TEXT NOT NULL,
          institution_id TEXT,
          academic_period_id TEXT,
          status TEXT,
          enrolled_at TEXT,
          exited_at TEXT,
          payload TEXT,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (tenant_id, id)
        )
      ''');
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_enrollments_cache_student '
        'ON enrollments_cache(tenant_id, student_id)',
      );
      // Tolerate re-runs by guarding against the columns already existing
      // (sqflite_common_ffi reports a duplicate-column error on retry).
      try {
        await db.execute(
          'ALTER TABLE institutions_cache ADD COLUMN latitude REAL',
        );
      } catch (_) {/* column already present */}
      try {
        await db.execute(
          'ALTER TABLE institutions_cache ADD COLUMN longitude REAL',
        );
      } catch (_) {/* column already present */}
    }
  }

  Future<void> close() async {
    final Database? existing = _db;
    if (existing != null) {
      await existing.close();
      _db = null;
    }
  }
}
