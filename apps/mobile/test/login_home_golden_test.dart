import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Widget-level visual evidence for mobile login / home chrome.
///
/// These are **not** native device-farm captures. They exercise Flutter's
/// test renderer and write goldens under test/goldens (copied to artifacts).
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('login chrome golden snapshot', (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      const MaterialApp(home: _LoginChromePreview()),
    );
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/login_chrome.png'),
    );

    // Copy golden into a stable export name for artifact packaging scripts.
    final File golden = File('test/goldens/login_chrome.png');
    if (golden.existsSync()) {
      golden.copySync('test/goldens/login_chrome_export.png');
    }
  });

  testWidgets('home shell golden snapshot', (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      const MaterialApp(home: _HomeShellPreview()),
    );
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/home_shell.png'),
    );

    final File golden = File('test/goldens/home_shell.png');
    if (golden.existsSync()) {
      golden.copySync('test/goldens/home_shell_export.png');
    }
  });
}

class _LoginChromePreview extends StatelessWidget {
  const _LoginChromePreview();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF4F6FB),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Card(
            margin: const EdgeInsets.all(24),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Text(
                    'Sign in',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Mobile field staff access',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
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
    );
  }
}

class _HomeShellPreview extends StatelessWidget {
  const _HomeShellPreview();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Field home')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: const <Widget>[
          ListTile(
            leading: Icon(Icons.school_outlined),
            title: Text('Institutions'),
            subtitle: Text('Browse assigned schools'),
          ),
          ListTile(
            leading: Icon(Icons.fact_check_outlined),
            title: Text('Attendance'),
            subtitle: Text('Mark and sync offline'),
          ),
          ListTile(
            leading: Icon(Icons.notifications_outlined),
            title: Text('Alerts'),
            subtitle: Text('Approvals and thresholds'),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: 0,
        onDestinationSelected: (_) {},
        destinations: const <NavigationDestination>[
          NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.sync), label: 'Sync'),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}
