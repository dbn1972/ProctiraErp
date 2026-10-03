import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/auth/auth_bloc.dart';
import 'package:proctira_mobile/core/storage/cache_crypto.dart';
import 'package:proctira_mobile/core/storage/captured_document_store.dart';
import 'package:proctira_mobile/core/storage/secure_storage.dart';

/// PRC-M046: scanned documents are sealed at rest and removed on
/// upload / logout.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory root;
  late CapturedDocumentStore store;
  late SecureStorage secure;

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    secure = SecureStorage(const FlutterSecureStorage());
    root = await Directory.systemTemp.createTemp('m046_');
    store = CapturedDocumentStore(
      crypto: await CacheCrypto.fromSecureStorage(secure),
      dir: () async => Directory('${root.path}/pending_documents'),
    );
  });

  test(
    'seal writes ciphertext, deletes the picker file, open decrypts',
    () async {
      final File picked = File('${root.path}/IMG.jpg');
      final Uint8List bytes = Uint8List.fromList(<int>[0xFF, 0xD8, 1, 2, 3]);
      await picked.writeAsBytes(bytes);
      final String path = await store.seal(picked);
      expect(await picked.exists(), isFalse);
      final String onDisk = await File(path).readAsString();
      expect(onDisk, startsWith(CacheCrypto.cipherPrefix));
      expect(await store.open(path), bytes);
    },
  );

  test('after upload success the file is removed', () async {
    final File picked = File('${root.path}/a.jpg')..writeAsBytesSync(<int>[1]);
    final String path = await store.seal(picked);
    await store.discard(path); // what the uploader calls on success
    expect(await File(path).exists(), isFalse);
  });

  test('after logout the capture directory is empty', () async {
    final File picked = File('${root.path}/b.jpg')..writeAsBytesSync(<int>[2]);
    await store.seal(picked);
    final AuthBloc auth = AuthBloc(
      secureStorage: secure,
      purgeLocalFiles: store.purgeAll,
    );
    auth.add(const AuthLogoutRequested());
    await auth.stream.firstWhere(
      (AuthState s) => s.status == AuthStatus.unauthenticated,
    );
    final Directory dir = Directory('${root.path}/pending_documents');
    expect(!await dir.exists() || dir.listSync().isEmpty, isTrue);
    await auth.close();
  });
}
