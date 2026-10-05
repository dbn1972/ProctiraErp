import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/storage/database.dart';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// PRC-M567: every offline cache/queue table must exist in the schema and be
/// wiped by [AppDatabase.purgeAllUserData] (logout / tenant switch).
/// Dropping a table from the schema, or adding one without purging it, fails.
const Set<String> _expectedUserTables = <String>{
  'pending_sync',
  'attendance_offline',
  'students_cache',
  'sync_conflicts',
  'notifications_cache',
  'institutions_cache',
  'enrollments_cache',
  'health_records_cache',
  // Added by the client DB migration in PR #542.
  'examinations_cache',
  'examination_results_cache',
  'assessment_results_cache',
};

/// Referenced by lib/ but not yet in the local schema (needs a client DB
/// migration). Kept explicit so the test flips when the migration lands.
const Set<String> _knownMissing = <String>{
  'scholarship_programs_cache',
  'scholarship_applications_cache',
};

Future<Set<String>> _tables(Database raw) async => (await raw.rawQuery(
  "SELECT name FROM sqlite_master WHERE type = 'table' "
  "AND name NOT LIKE 'sqlite_%' AND name != 'android_metadata'",
)).map((Map<String, Object?> r) => r['name']! as String).toSet();

/// Inserts one row using placeholder values for every NOT NULL column.
Future<void> _insertDummy(Database raw, String table) async {
  final List<Map<String, Object?>> cols = await raw.rawQuery(
    'PRAGMA table_info($table)',
  );
  final Map<String, Object?> row = <String, Object?>{};
  for (final Map<String, Object?> c in cols) {
    final bool required = (c['notnull'] as int) == 1 || (c['pk'] as int) == 1;
    if (!required || c['dflt_value'] != null) continue;
    final String type = '${c['type']}'.toUpperCase();
    row[c['name']! as String] = type.contains('INT') || type.contains('REAL')
        ? 1
        : 'x-${c['name']}';
  }
  await raw.insert(table, row);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late Directory dir;
  late AppDatabase db;
  setUp(() async {
    dir = await Directory.systemTemp.createTemp('m567_schema_');
    db = AppDatabase(overridePath: '${dir.path}/o.db');
  });
  tearDown(() async {
    await db.close();
    await dir.delete(recursive: true);
  });

  test('schema contains every user-data table', () async {
    final Set<String> tables = await _tables(await db.database);
    expect(tables, containsAll(_expectedUserTables));
  });

  test('purgeAllUserData empties every user-data table', () async {
    final Database raw = await db.database;
    for (final String t in _expectedUserTables) {
      await _insertDummy(raw, t);
    }
    await db.purgeAllUserData();
    for (final String t in _expectedUserTables) {
      final int n =
          Sqflite.firstIntValue(
            await raw.rawQuery('SELECT COUNT(*) FROM $t'),
          ) ??
          -1;
      expect(n, 0, reason: '$t must be purged');
    }
  });

  test('no table outside the purge list holds user data', () async {
    final Set<String> tables = await _tables(await db.database);
    expect(
      tables.difference(_expectedUserTables),
      isEmpty,
      reason: 'new tables must be added to purgeAllUserData and this test',
    );
  });

  test(
    'every *_cache table referenced in lib/ exists (or is known-missing)',
    () async {
      final RegExp ref = RegExp(r"'([a-z_]+_cache)'");
      final Set<String> referenced = <String>{};
      for (final FileSystemEntity f in Directory(
        'lib',
      ).listSync(recursive: true)) {
        if (f is File && f.path.endsWith('.dart')) {
          for (final RegExpMatch m in ref.allMatches(f.readAsStringSync())) {
            referenced.add(m.group(1)!);
          }
        }
      }
      final Set<String> tables = await _tables(await db.database);
      expect(referenced.difference(tables).difference(_knownMissing), isEmpty);
      // When the scholarship cache migration lands, move these into the
      // expected set above.
      expect(tables.intersection(_knownMissing), isEmpty);
    },
  );
}
