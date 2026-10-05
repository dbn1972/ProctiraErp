import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/storage/cache_crypto.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';
import 'package:proctira_mobile/features/reports/data/report_file_store.dart';

/// PRC-M045: downloaded reports are sealed at rest, kept out of device
/// backups, and removed (with any legacy plaintext copies) on purge.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory root;
  late ReportFileStore store;

  // "%PDF-1.7" followed by a fake name, to prove no plaintext lands on disk.
  final Uint8List pdf = Uint8List.fromList(
    '%PDF-1.7 Student: Example Child'.codeUnits,
  );

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    final SecureStorage secure = SecureStorage(const FlutterSecureStorage());
    root = await Directory.systemTemp.createTemp('m045_');
    store = ReportFileStore(
      crypto: await CacheCrypto.fromSecureStorage(secure),
      dir: () async => Directory('${root.path}/cache/reports'),
      legacyDir: () async => Directory('${root.path}/documents/reports'),
    );
  });

  tearDown(() async {
    if (await root.exists()) await root.delete(recursive: true);
  });

  test('save writes only ciphertext and open round-trips the bytes', () async {
    final String path = await store.save('rep/1', pdf);
    expect(path, startsWith('${root.path}/cache/reports/'));
    final String onDisk = await File(path).readAsString();
    expect(onDisk, startsWith(CacheCrypto.contextCipherPrefix));
    expect(onDisk, isNot(contains('%PDF')));
    expect(onDisk, isNot(contains('Example Child')));
    expect(await store.open('rep/1'), pdf);
  });

  test('ciphertext is bound to its report id', () async {
    final String path = await store.save('rep-a', pdf);
    final String other = path.replaceFirst('rep-a', 'rep-b');
    await File(path).copy(other);
    await expectLater(store.open('rep-b'), throwsA(anything));
  });

  test('purgeAll removes saved and legacy plaintext reports', () async {
    await store.save('rep-1', pdf);
    final File legacy = File('${root.path}/documents/reports/rep-1.pdf');
    await legacy.parent.create(recursive: true);
    await legacy.writeAsBytes(pdf);
    await store.purgeAll();
    expect(await Directory('${root.path}/cache/reports').exists(), isFalse);
    expect(await legacy.exists(), isFalse);
    expect(await store.open('rep-1'), isNull);
  });

  test('Android backup and device transfer exclude the reports dir', () {
    for (final String name in <String>[
      'backup_rules.xml',
      'data_extraction_rules.xml',
    ]) {
      final String xml = File(
        'android/app/src/main/res/xml/$name',
      ).readAsStringSync();
      expect(xml, contains('<exclude domain="file" path="reports/" />'));
      expect(xml, contains('<exclude domain="root" path="cache/reports/" />'));
      expect(
        xml,
        contains('<exclude domain="root" path="app_flutter/reports/" />'),
      );
    }
  });
}
