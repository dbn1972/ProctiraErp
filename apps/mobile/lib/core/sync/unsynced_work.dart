import 'package:equatable/equatable.dart';
import 'package:sqflite/sqflite.dart';

import '../storage/database.dart';

/// On-device work that has not reached the server and would be lost by a
/// full user-data purge (workspace switch).
class UnsyncedWork extends Equatable {
  const UnsyncedWork({
    this.queuedChanges = 0,
    this.conflicts = 0,
    this.capturedDocuments = 0,
    this.inspectionFailed = false,
  });

  /// The queue could not be read; callers must treat this as "not empty"
  /// (fail closed) rather than assume nothing is pending.
  const UnsyncedWork.unknown() : this(inspectionFailed: true);

  /// Rows in `pending_sync` in any state (pending, parked, conflicted), or
  /// unsynced attendance marks, whichever is larger.
  final int queuedChanges;

  /// Rows in `sync_conflicts` awaiting the user's review.
  final int conflicts;

  /// Sealed scanned documents in `pending_documents/` awaiting upload.
  final int capturedDocuments;

  final bool inspectionFailed;

  bool get isEmpty =>
      !inspectionFailed &&
      queuedChanges == 0 &&
      conflicts == 0 &&
      capturedDocuments == 0;

  /// Plain-language summary for confirmation dialogs.
  String describe() {
    if (inspectionFailed) {
      return "Offline changes on this device couldn't be checked.";
    }
    final List<String> parts = <String>[
      if (queuedChanges > 0) _plural(queuedChanges, 'unsynced change'),
      if (conflicts > 0) _plural(conflicts, 'sync conflict'),
      if (capturedDocuments > 0)
        _plural(capturedDocuments, 'scanned document'),
    ];
    return "This device has work that hasn't reached the server yet: "
        '${parts.join(', ')}.';
  }

  static String _plural(int n, String noun) => '$n $noun${n == 1 ? '' : 's'}';

  @override
  List<Object?> get props => <Object?>[
    queuedChanges,
    conflicts,
    capturedDocuments,
    inspectionFailed,
  ];
}

/// Counts unsynced work across ALL tenants: the workspace-switch purge
/// deletes every tenant's rows, not just the active one.
class UnsyncedWorkInspector {
  UnsyncedWorkInspector({
    required AppDatabase database,
    Future<int> Function()? countCapturedDocuments,
  }) : _database = database,
       _countCapturedDocuments = countCapturedDocuments;

  final AppDatabase _database;
  final Future<int> Function()? _countCapturedDocuments;

  Future<UnsyncedWork> inspect() async {
    final Database db = await _database.database;
    final int queued = await _count(db, 'SELECT COUNT(*) FROM pending_sync');
    final int marks = await _count(
      db,
      'SELECT COUNT(*) FROM attendance_offline WHERE synced = 0',
    );
    final int conflicts = await _count(
      db,
      'SELECT COUNT(*) FROM sync_conflicts',
    );
    return UnsyncedWork(
      queuedChanges: queued > marks ? queued : marks,
      conflicts: conflicts,
      capturedDocuments: await _countCapturedDocuments?.call() ?? 0,
    );
  }

  static Future<int> _count(Database db, String sql) async =>
      Sqflite.firstIntValue(await db.rawQuery(sql)) ?? 0;
}
