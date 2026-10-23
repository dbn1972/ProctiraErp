import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'helpers/test_setup.dart';

/// Captures **real** Linux-desktop rendered PNGs of actual production
/// screens (PRC-L401).
///
/// Previously this file painted 4 hand-built mock Scaffold/ListTile widgets
/// that never touched app code. This pumps the real [AppRouter] app (the
/// same `buildJourneyApp()`/`goJourney()` harness every other hardened
/// journey uses) wrapped in a single [RepaintBoundary], then navigates to
/// the login, home, notification-preferences, and reports routes,
/// capturing each as rendered by the Linux Flutter embedder under xvfb.
///
/// Residual: this only proves rendering under the Linux desktop embedder,
/// not real Android/iOS device-farm screenshots -- pre-existing, unrelated
/// to this fix.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  /// Output directory, configurable via `MOBILE_SCREENSHOT_DIR` so this test
  /// can run anywhere `/opt/cursor` isn't writable; falls back to the
  /// existing hardcoded CI path when unset (no change to current CI
  /// behavior).
  Directory outputDir() {
    final String? override = Platform.environment['MOBILE_SCREENSHOT_DIR'];
    return Directory(
      override != null && override.isNotEmpty
          ? override
          : '/opt/cursor/artifacts/mobile-flutter-audit',
    );
  }

  final GlobalKey repaintKey = GlobalKey();

  Future<void> captureCurrentRoute(WidgetTester tester, String name) async {
    final RenderObject? renderObject = repaintKey.currentContext
        ?.findRenderObject();
    expect(renderObject, isA<RenderRepaintBoundary>());
    final ui.Image image = await (renderObject! as RenderRepaintBoundary)
        .toImage(pixelRatio: 2);
    final ByteData? bytes = await image.toByteData(
      format: ui.ImageByteFormat.png,
    );
    expect(bytes, isNotNull);
    final Directory outDir = outputDir();
    outDir.createSync(recursive: true);
    File(
      '${outDir.path}/linux_$name.png',
    ).writeAsBytesSync(bytes!.buffer.asUint8List());
  }

  testWidgets(
    'linux screenshots: login + notification prefs + reports + home shell',
    (WidgetTester tester) async {
      final JourneyHarness harness = await bootstrapTestApp(
        tenantId: 'tenant-screenshot',
        tenantDisplayName: 'Screenshot School',
      );
      addTearDown(harness.dispose);
      await harness.bootstrapAuth();
      await tester.pumpWidget(
        RepaintBoundary(key: repaintKey, child: buildJourneyApp()),
      );
      await tester.pumpAndSettle(const Duration(milliseconds: 200));
      expect(currentJourneyPath(), '/login');
      await captureCurrentRoute(tester, 'login_chrome');

      await harness.markAuthenticated();
      await tester.pumpAndSettle();
      expect(currentJourneyPath(), '/');
      await captureCurrentRoute(tester, 'home_shell');

      goJourney('/notifications/preferences');
      await tester.pumpAndSettle();
      await captureCurrentRoute(tester, 'notification_preferences');

      goJourney('/reports');
      await tester.pumpAndSettle();
      await captureCurrentRoute(tester, 'reports');

      final Directory outDir = outputDir();
      for (final String name in <String>[
        'login_chrome',
        'notification_preferences',
        'reports',
        'home_shell',
      ]) {
        expect(
          File('${outDir.path}/linux_$name.png').existsSync(),
          isTrue,
          reason: 'Expected linux_$name.png from Linux embedder capture',
        );
      }
    },
  );
}
