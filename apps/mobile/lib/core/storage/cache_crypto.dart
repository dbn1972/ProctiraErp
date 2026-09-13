import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

import 'secure_storage.dart';

/// AES-256-GCM seal/open for child PII written into the offline SQLite cache.
///
/// Ciphertext is stored as `enc:v1:` + base64(nonce || cipherText || mac).
/// Values without the prefix are treated as legacy plaintext (read-only) so
/// older rows can still be decoded until schema v6 wipes them.
class CacheCrypto {
  CacheCrypto(this._keyBytes);

  static const String cipherPrefix = 'enc:v1:';
  static const int _nonceLength = 12;
  static const int _macLength = 16;

  final Uint8List _keyBytes;
  final AesGcm _algorithm = AesGcm.with256bits();

  /// Loads or creates a 32-byte master key in [SecureStorage].
  static Future<CacheCrypto> fromSecureStorage(SecureStorage storage) async {
    final Uint8List key = await storage.getOrCreateCacheMasterKey();
    return CacheCrypto(key);
  }

  Future<String> encrypt(String plaintext) async {
    final SecretKey secretKey = SecretKey(_keyBytes);
    final List<int> nonce = _algorithm.newNonce();
    final SecretBox box = await _algorithm.encrypt(
      utf8.encode(plaintext),
      secretKey: secretKey,
      nonce: nonce,
    );
    final BytesBuilder combined = BytesBuilder(copy: false)
      ..add(nonce)
      ..add(box.cipherText)
      ..add(box.mac.bytes);
    return '$cipherPrefix${base64Encode(combined.toBytes())}';
  }

  Future<String?> encryptNullable(String? plaintext) async {
    if (plaintext == null) {
      return null;
    }
    return encrypt(plaintext);
  }

  Future<String> decrypt(String value) async {
    if (!value.startsWith(cipherPrefix)) {
      return value;
    }
    final Uint8List raw =
        Uint8List.fromList(base64Decode(value.substring(cipherPrefix.length)));
    if (raw.length < _nonceLength + _macLength + 1) {
      throw StateError('Truncated cache ciphertext');
    }
    final List<int> nonce = raw.sublist(0, _nonceLength);
    final List<int> macBytes = raw.sublist(raw.length - _macLength);
    final List<int> cipherText =
        raw.sublist(_nonceLength, raw.length - _macLength);
    final List<int> clear = await _algorithm.decrypt(
      SecretBox(cipherText, nonce: nonce, mac: Mac(macBytes)),
      secretKey: SecretKey(_keyBytes),
    );
    return utf8.decode(clear);
  }

  Future<String?> decryptNullable(String? value) async {
    if (value == null) {
      return null;
    }
    return decrypt(value);
  }
}

/// Cryptographically secure 32 random bytes for [SecureStorage].
Uint8List generateCacheMasterKey({Random? random}) {
  final Random rng = random ?? Random.secure();
  return Uint8List.fromList(
    List<int>.generate(32, (_) => rng.nextInt(256)),
  );
}
