import 'dart:io';
import 'dart:typed_data';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Persists downloaded report bytes and returns where they went.
typedef ReportFileSaver =
    Future<String> Function(String reportId, Uint8List bytes);

Future<Directory> _reportsDir() async => Directory(
  p.join((await getApplicationDocumentsDirectory()).path, 'reports'),
);

/// Default saver: app-private documents storage (not shared or external),
/// replacing any earlier copy of the same report (PRC-M045).
Future<String> saveReportToAppStorage(String reportId, Uint8List bytes) async {
  final Directory dir = await _reportsDir();
  await dir.create(recursive: true);
  final String safeId = reportId.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
  final File file = File(p.join(dir.path, '$safeId.pdf'));
  await file.writeAsBytes(bytes, flush: true);
  return file.path;
}

/// Delete every saved report. Called on logout.
Future<void> purgeSavedReports() async {
  final Directory dir = await _reportsDir();
  if (await dir.exists()) await dir.delete(recursive: true);
}
