import 'package:flutter_test/flutter_test.dart';
import 'package:proctira_mobile/core/di/injector.dart';

/// PRC-M470 — the API base URL guard must reject cleartext endpoints in
/// release builds while still allowing http:// for local dev/debug builds.
void main() {
  group('assertSecureApiBaseUrl', () {
    test('rejects cleartext http in release builds', () {
      expect(
        () => assertSecureApiBaseUrl('http://127.0.0.1:3000', isRelease: true),
        throwsA(isA<StateError>()),
      );
    });

    test('allows https in release builds', () {
      expect(
        () => assertSecureApiBaseUrl('https://api.proctira.io', isRelease: true),
        returnsNormally,
      );
    });

    test('allows cleartext http in non-release (debug) builds', () {
      expect(
        () => assertSecureApiBaseUrl('http://127.0.0.1:3000', isRelease: false),
        returnsNormally,
      );
    });

    test('rejects a malformed URL regardless of build mode', () {
      expect(
        () => assertSecureApiBaseUrl('not a url', isRelease: false),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('rejects an unsupported scheme', () {
      expect(
        () => assertSecureApiBaseUrl('ftp://host/path', isRelease: false),
        throwsA(isA<ArgumentError>()),
      );
    });
  });
}
