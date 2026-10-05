import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// PRC-M471: Inter is bundled locally and runtime fetching is disabled, so
/// release builds render offline.
void main() {
  test('every Inter weight in pubspec exists in assets/fonts', () {
    final String pubspec = File('pubspec.yaml').readAsStringSync();
    final Iterable<String> assets = RegExp(
      r'asset:\s*(assets/fonts/Inter-[A-Za-z]+\.ttf)',
    ).allMatches(pubspec).map((RegExpMatch m) => m.group(1)!);
    expect(assets, isNotEmpty);
    for (final String path in assets) {
      expect(File(path).existsSync(), isTrue, reason: path);
      expect(File(path).lengthSync(), greaterThan(10000), reason: path);
    }
  });

  test('main disables GoogleFonts runtime fetching', () {
    expect(
      File('lib/main.dart').readAsStringSync(),
      contains('GoogleFonts.config.allowRuntimeFetching = false'),
    );
  });

  test('stricter analyzer options are enabled', () {
    final String opts = File('analysis_options.yaml').readAsStringSync();
    for (final String rule in <String>[
      'strict-casts: true',
      'strict-raw-types: true',
      'unawaited_futures: true',
      'avoid_dynamic_calls: true',
    ]) {
      expect(opts, contains(rule));
    }
  });
}
