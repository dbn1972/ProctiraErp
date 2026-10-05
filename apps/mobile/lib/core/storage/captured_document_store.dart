import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import 'cache_crypto.dart';

Future<Directory> defaultCapturedDocumentsDir() async => Directory(
  p.join((await getApplicationSupportDirectory()).path, 'pending_documents'),
);

/// App-private, encrypted holding area for scanned identity documents
/// awaiting upload (PRC-M046).
///
/// The picker's temp file is sealed with [CacheCrypto] (key in platform
/// secure storage) into [dir] and then deleted, so no plaintext copy of the
/// child's document remains on disk. Files keep their original extension so
/// the uploader can infer the MIME type; content is ciphertext.
class CapturedDocumentStore {
  CapturedDocumentStore({
    required CacheCrypto crypto,
    Future<Directory> Function() dir = defaultCapturedDocumentsDir,
  }) : _crypto = crypto,
       _dir = dir;

  final CacheCrypto _crypto;
  final Future<Directory> Function() _dir;

  /// Seal [source] into the store, delete the plaintext original, and
  /// return the stored path.
  Future<String> seal(File source) async {
    final Directory dir = await _dir();
    await dir.create(recursive: true);
    final String path = p.join(
      dir.path,
      '${const Uuid().v4()}${p.extension(source.path).toLowerCase()}',
    );
    final Uint8List bytes = await source.readAsBytes();
    await File(path).writeAsString(await _crypto.encrypt(base64Encode(bytes)));
    await discard(source.path);
    return path;
  }

  /// Plaintext bytes of a stored document, or null when missing. Legacy
  /// unsealed files (queued before PRC-M046) are returned as-is.
  Future<Uint8List?> open(String path) async {
    final File file = File(path);
    if (!await file.exists()) return null;
    final Uint8List raw = await file.readAsBytes();
    final String prefix = CacheCrypto.cipherPrefix;
    if (raw.length >= prefix.length &&
        ascii.decode(raw.sublist(0, prefix.length), allowInvalid: true) ==
            prefix) {
      return base64Decode(await _crypto.decrypt(utf8.decode(raw)));
    }
    return raw;
  }

  /// Best-effort delete of one file (picker temp, discarded or uploaded).
  Future<void> discard(String path) async {
    try {
      final File file = File(path);
      if (await file.exists()) await file.delete();
    } catch (_) {
      // Already gone or not ours to delete.
    }
  }

  /// Number of stored captures still awaiting upload.
  Future<int> count() async {
    final Directory dir = await _dir();
    if (!await dir.exists()) return 0;
    int n = 0;
    await for (final FileSystemEntity entity in dir.list()) {
      if (entity is File) n += 1;
    }
    return n;
  }

  /// Remove every stored capture. Called on logout.
  Future<void> purgeAll() async {
    final Directory dir = await _dir();
    if (await dir.exists()) await dir.delete(recursive: true);
  }
}
