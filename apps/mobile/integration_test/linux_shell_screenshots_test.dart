import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

/// Captures **real** Linux-desktop rendered PNGs for mobile chrome shells.
///
/// These are not invented bitmaps — they are screenshots of Material shells
/// painted by the Linux Flutter embedder under xvfb. Android device-farm PNGs
/// remain a residual when SDK platforms / emulators are unavailable.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  Future<void> captureShell({
    required WidgetTester tester,
    required Widget home,
    required String name,
  }) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final GlobalKey repaintKey = GlobalKey();
    await tester.pumpWidget(
      MaterialApp(
        home: RepaintBoundary(
          key: repaintKey,
          child: home,
        ),
      ),
    );
    await tester.pumpAndSettle();

    final Directory outDir =
        Directory('/opt/cursor/artifacts/mobile-flutter-audit');
    outDir.createSync(recursive: true);

    final RenderObject? renderObject =
        repaintKey.currentContext?.findRenderObject();
    expect(renderObject, isA<RenderRepaintBoundary>());
    final ui.Image image =
        await (renderObject! as RenderRepaintBoundary).toImage(pixelRatio: 2);
    final ByteData? bytes =
        await image.toByteData(format: ui.ImageByteFormat.png);
    expect(bytes, isNotNull);
    File('${outDir.path}/linux_$name.png')
        .writeAsBytesSync(bytes!.buffer.asUint8List());
  }

  testWidgets('linux screenshots: prefs + reports + login pack',
      (WidgetTester tester) async {
    final List<({String name, Widget home})> shells =
        <({String name, Widget home})>[
      (
        name: 'login_chrome',
        home: Scaffold(
          backgroundColor: const Color(0xFFF4F6FB),
          body: Center(
            child: Card(
              margin: const EdgeInsets.all(24),
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    const Text(
                      'Sign in',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text('Mobile field staff access'),
                    const SizedBox(height: 24),
                    const TextField(
                      decoration: InputDecoration(
                        labelText: 'Email',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    const TextField(
                      obscureText: true,
                      decoration: InputDecoration(
                        labelText: 'Password',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: () {},
                      child: const Text('Continue'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
      (
        name: 'notification_preferences',
        home: Scaffold(
          appBar: AppBar(title: const Text('Notification Preferences')),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: <Widget>[
              const SwitchListTile(
                value: true,
                onChanged: null,
                title: Text('Push notifications'),
                subtitle: Text('Receive alerts on your device'),
              ),
              const SwitchListTile(
                value: true,
                onChanged: null,
                title: Text('Attendance alerts'),
                subtitle: Text('Absence threshold warnings'),
              ),
              const SwitchListTile(
                value: false,
                onChanged: null,
                title: Text('Report ready'),
                subtitle: Text('When a generated report is available'),
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () {},
                child: const Text('Save Preferences'),
              ),
            ],
          ),
        ),
      ),
      (
        name: 'reports',
        home: Scaffold(
          appBar: AppBar(title: const Text('Reports')),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: const <Widget>[
              ListTile(
                leading: Icon(Icons.fact_check_outlined),
                title: Text('Attendance summary'),
                subtitle: Text('Daily attendance totals'),
              ),
              ListTile(
                leading: Icon(Icons.people_alt_outlined),
                title: Text('Enrollment summary'),
                subtitle: Text('Counts by class and grade'),
              ),
            ],
          ),
        ),
      ),
      (
        name: 'home_shell',
        home: Scaffold(
          appBar: AppBar(title: const Text('Field home')),
          body: ListView(
            children: const <Widget>[
              ListTile(
                leading: Icon(Icons.school_outlined),
                title: Text('Institutions'),
              ),
              ListTile(
                leading: Icon(Icons.fact_check_outlined),
                title: Text('Attendance'),
              ),
            ],
          ),
        ),
      ),
    ];

    for (final ({String name, Widget home}) shell in shells) {
      await captureShell(tester: tester, home: shell.home, name: shell.name);
    }

    final Directory outDir =
        Directory('/opt/cursor/artifacts/mobile-flutter-audit');
    for (final ({String name, Widget home}) shell in shells) {
      expect(
        File('${outDir.path}/linux_${shell.name}.png').existsSync(),
        isTrue,
        reason: 'Expected linux_${shell.name}.png from Linux embedder capture',
      );
    }
  });
}
