import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/storage/cache_crypto.dart';

/// PRC-L008: plaintext must not pass through decrypt, and context-bound
/// ciphertext must not open under another row/tenant context.
void main() {
  final CacheCrypto crypto = CacheCrypto(
    Uint8List.fromList(List<int>.generate(32, (int i) => i)),
  );

  String ctx(String tenant, String id) => CacheCrypto.rowContext(
    tenantId: tenant,
    table: 'health_records_cache',
    id: id,
  );

  test(
    'unprefixed plaintext value throws instead of passing through',
    () async {
      await expectLater(crypto.decrypt('Asha Kumar'), throwsStateError);
      await expectLater(crypto.decryptNullable('1234-5678'), throwsStateError);
    },
  );

  test('context-bound ciphertext round-trips with the same context', () async {
    final String sealed = await crypto.encrypt(
      'secret',
      context: ctx('t1', 's1'),
    );
    expect(sealed, startsWith(CacheCrypto.contextCipherPrefix));
    expect(await crypto.decrypt(sealed, context: ctx('t1', 's1')), 'secret');
  });

  test('ciphertext moved to another row fails to decrypt', () async {
    final String sealed = await crypto.encrypt(
      'secret',
      context: ctx('t1', 's1'),
    );
    await expectLater(
      crypto.decrypt(sealed, context: ctx('t1', 's2')),
      throwsA(anything),
    );
  });

  test('ciphertext moved to another tenant fails to decrypt', () async {
    final String sealed = await crypto.encrypt(
      'secret',
      context: ctx('t1', 's1'),
    );
    await expectLater(
      crypto.decrypt(sealed, context: ctx('t2', 's1')),
      throwsA(anything),
    );
  });

  test('context-bound ciphertext read without context throws', () async {
    final String sealed = await crypto.encrypt(
      'secret',
      context: ctx('t1', 's1'),
    );
    await expectLater(crypto.decrypt(sealed), throwsStateError);
  });

  test('legacy v1 ciphertext (no context) is still readable', () async {
    final String sealed = await crypto.encrypt('legacy');
    expect(sealed, startsWith(CacheCrypto.cipherPrefix));
    expect(await crypto.decrypt(sealed), 'legacy');
    expect(await crypto.decrypt(sealed, context: ctx('t1', 's1')), 'legacy');
  });
}
