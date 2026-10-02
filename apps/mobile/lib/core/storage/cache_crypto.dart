import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

import 'secure_storage.dart';

/// AES-256-GCM seal/open for child PII written into the offline SQLite cache.
///
/// Ciphertext is stored as `enc:v1:` / `enc:v2:` + base64(nonce || cipherText
/// || mac). `v2` binds the ciphertext to a row context (`tenantId|table|id`)
/// via GCM associated data, so a value copied into another row or tenant
/// fails authentication (PRC-L008). `v1` (no context) is still readable for
/// rows written before v2.
///
/// Unprefixed values are rejected: schema v6 wiped legacy plaintext caches,
/// so plaintext on read means tampering or a bug, never valid data.
class CacheCrypto {
  CacheCrypto(this._keyBytes);

  static const String cipherPrefix = 'enc:v1:';
  static const String contextCipherPrefix = 'enc:v2:';
  static const int _nonceLength = 12;
  static const int _macLength = 16;

  final Uint8List _keyBytes;
  final AesGcm _algorithm = AesGcm.with256bits();

  /// Loads or creates a 32-byte master key in [SecureStorage].
  static Future<CacheCrypto> fromSecureStorage(SecureStorage storage) async {
    final Uint8List key = await storage.getOrCreateCacheMasterKey();
    return CacheCrypto(key);
  }

  /// Canonical row context used as associated data.
  static String rowContext({
    required String tenantId,
    required String table,
    required String id,
  }) => '$tenantId|$table|$id';

  /// Seals [plaintext]. When [context] is given (see [rowContext]) the
  /// ciphertext is bound to it and can only be opened with the same context.
  Future<String> encrypt(String plaintext, {String? context}) async {
    final SecretKey secretKey = SecretKey(_keyBytes);
    final List<int> nonce = _algorithm.newNonce();
    final SecretBox box = await _algorithm.encrypt(
      utf8.encode(plaintext),
      secretKey: secretKey,
      nonce: nonce,
      aad: context == null ? const <int>[] : utf8.encode(context),
    );
    final BytesBuilder combined = BytesBuilder(copy: false)
      ..add(nonce)
      ..add(box.cipherText)
      ..add(box.mac.bytes);
    final String prefix = context == null ? cipherPrefix : contextCipherPrefix;
    return '$prefix${base64Encode(combined.toBytes())}';
  }

  Future<String?> encryptNullable(String? plaintext, {String? context}) async {
    if (plaintext == null) {
      return null;
    }
    return encrypt(plaintext, context: context);
  }

  /// Opens [value]. Throws [StateError] for unprefixed (plaintext) values,
  /// for `v2` values read without a [context], and (via the cipher) when the
  /// context or ciphertext does not authenticate.
  Future<String> decrypt(String value, {String? context}) async {
    final List<int> aad;
    final String body;
    if (value.startsWith(contextCipherPrefix)) {
      if (context == null) {
        throw StateError('Context-bound cache ciphertext read without context');
      }
      aad = utf8.encode(context);
      body = value.substring(contextCipherPrefix.length);
    } else if (value.startsWith(cipherPrefix)) {
      aad = const <int>[];
      body = value.substring(cipherPrefix.length);
    } else {
      throw StateError('Unsealed value in encrypted cache');
    }
    final Uint8List raw = Uint8List.fromList(base64Decode(body));
    if (raw.length < _nonceLength + _macLength + 1) {
      throw StateError('Truncated cache ciphertext');
    }
    final List<int> nonce = raw.sublist(0, _nonceLength);
    final List<int> macBytes = raw.sublist(raw.length - _macLength);
    final List<int> cipherText = raw.sublist(
      _nonceLength,
      raw.length - _macLength,
    );
    final List<int> clear = await _algorithm.decrypt(
      SecretBox(cipherText, nonce: nonce, mac: Mac(macBytes)),
      secretKey: SecretKey(_keyBytes),
      aad: aad,
    );
    return utf8.decode(clear);
  }

  Future<String?> decryptNullable(String? value, {String? context}) async {
    if (value == null) {
      return null;
    }
    return decrypt(value, context: context);
  }
}

/// Cryptographically secure 32 random bytes for [SecureStorage].
Uint8List generateCacheMasterKey({Random? random}) {
  final Random rng = random ?? Random.secure();
  return Uint8List.fromList(List<int>.generate(32, (_) => rng.nextInt(256)));
}
