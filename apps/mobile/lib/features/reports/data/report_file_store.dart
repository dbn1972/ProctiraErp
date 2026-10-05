import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../../../core/storage/cache_crypto.dart';

/// Persists downloaded report bytes and returns where they went.
typedef ReportFileSaver =
    Future<String> Function(String reportId, Uint8List bytes);

/// Reports live in the app cache directory, which neither Android Auto
/// Backup / device transfer (`cacheDir`) nor iCloud/iTunes backup
/// (`Library/Caches`) copies, so no per-file no-backup attribute is needed.
/// The OS may evict them under storage pressure; they can be re-downloaded.
Future<Directory> defaultReportsDir() async => Directory(
  p.join((await getApplicationCacheDirectory()).path, 'reports'),
);

/// Where an earlier build wrote plaintext PDFs (backed-up Documents dir).
/// Only purged, never written.
Future<Directory> legacyReportsDir() async => Directory(
  p.join((await getApplicationDocumentsDirectory()).path, 'reports'),
);

/// App-private, encrypted store for downloaded reports (PRC-M045).
///
/// Server reports (rosters, report cards, attendance) carry student PII, so
/// bytes are sealed with [CacheCrypto] (key in platform secure storage) and
/// bound to the report id; no plaintext copy is written.
class ReportFileStore {
  ReportFileStore({
    required CacheCrypto crypto,
    Future<Directory> Function() dir = defaultReportsDir,
    Future<Directory> Function()? legacyDir = legacyReportsDir,
  }) : _crypto = crypto,
       _dir = dir,
       _legacyDir = legacyDir;

  final CacheCrypto _crypto;
  final Future<Directory> Function() _dir;
  final Future<Directory> Function()? _legacyDir;

  static String _safeId(String reportId) =>
      reportId.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');

  static String _context(String reportId) => 'reports|${_safeId(reportId)}';

  Future<File> _file(String reportId) async =>
      File(p.join((await _dir()).path, '${_safeId(reportId)}.pdf.enc'));

  /// Seal [bytes] for [reportId], replacing any earlier copy, and return
  /// the stored path. Matches [ReportFileSaver].
  Future<String> save(String reportId, Uint8List bytes) async {
    final File file = await _file(reportId);
    await file.parent.create(recursive: true);
    final String sealed = await _crypto.encrypt(
      base64Encode(bytes),
      context: _context(reportId),
    );
    await file.writeAsString(sealed, flush: true);
    return file.path;
  }

  /// Plaintext bytes of a saved report, or null when none is stored.
  Future<Uint8List?> open(String reportId) async {
    final File file = await _file(reportId);
    if (!await file.exists()) return null;
    return base64Decode(
      await _crypto.decrypt(
        await file.readAsString(),
        context: _context(reportId),
      ),
    );
  }

  /// Delete every saved report, including plaintext copies left in the
  /// legacy location. Called on logout and workspace switch.
  Future<void> purgeAll() async {
    await _deleteDir(await _dir());
    final Future<Directory> Function()? legacy = _legacyDir;
    if (legacy != null) await _deleteDir(await legacy());
  }

  static Future<void> _deleteDir(Directory dir) async {
    if (await dir.exists()) await dir.delete(recursive: true);
  }
}
