import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Widget-level visual evidence for mobile chrome shells.
///
/// These are **not** native device-farm captures. They exercise Flutter's
/// test renderer and write goldens under test/goldens (copied to artifacts).
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<void> snapshotShell({
    required WidgetTester tester,
    required Widget home,
    required String goldenName,
  }) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(MaterialApp(home: home));
    await tester.pumpAndSettle();

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/$goldenName.png'),
    );

    final File golden = File('test/goldens/$goldenName.png');
    if (golden.existsSync()) {
      golden.copySync('test/goldens/${goldenName}_export.png');
    }
  }

  testWidgets('login chrome golden snapshot', (WidgetTester tester) async {
    await snapshotShell(
      tester: tester,
      home: const _LoginChromePreview(),
      goldenName: 'login_chrome',
    );
  });

  testWidgets('home shell golden snapshot', (WidgetTester tester) async {
    await snapshotShell(
      tester: tester,
      home: const _HomeShellPreview(),
      goldenName: 'home_shell',
    );
  });

  testWidgets('students shell golden snapshot', (WidgetTester tester) async {
    await snapshotShell(
      tester: tester,
      home: const _StudentsShellPreview(),
      goldenName: 'students_shell',
    );
  });

  testWidgets('attendance shell golden snapshot', (WidgetTester tester) async {
    await snapshotShell(
      tester: tester,
      home: const _AttendanceShellPreview(),
      goldenName: 'attendance_shell',
    );
  });

  testWidgets('institutions shell golden snapshot', (WidgetTester tester) async {
    await snapshotShell(
      tester: tester,
      home: const _InstitutionsShellPreview(),
      goldenName: 'institutions_shell',
    );
  });

  testWidgets('scholarships shell golden snapshot', (WidgetTester tester) async {
    await snapshotShell(
      tester: tester,
      home: const _ScholarshipsShellPreview(),
      goldenName: 'scholarships_shell',
    );
  });

  testWidgets('health shell golden snapshot', (WidgetTester tester) async {
    await snapshotShell(
      tester: tester,
      home: const _HealthShellPreview(),
      goldenName: 'health_shell',
    );
  });

  testWidgets('examinations shell golden snapshot', (WidgetTester tester) async {
    await snapshotShell(
      tester: tester,
      home: const _ExaminationsShellPreview(),
      goldenName: 'examinations_shell',
    );
  });

  testWidgets('profile shell golden snapshot', (WidgetTester tester) async {
    await snapshotShell(
      tester: tester,
      home: const _ProfileShellPreview(),
      goldenName: 'profile_shell',
    );
  });

  testWidgets('notifications shell golden snapshot', (WidgetTester tester) async {
    await snapshotShell(
      tester: tester,
      home: const _NotificationsShellPreview(),
      goldenName: 'notifications_shell',
    );
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

class _StudentsShellPreview extends StatelessWidget {
  const _StudentsShellPreview();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Students')),
      body: SafeArea(
        child: Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: TextField(
                decoration: InputDecoration(
                  hintText: 'Search by name or ID',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: IconButton(
                    icon: const Icon(Icons.refresh),
                    tooltip: 'Refresh',
                    onPressed: () {},
                  ),
                ),
              ),
            ),
            Expanded(
              child: ListView(
                children: const <Widget>[
                  ListTile(
                    leading: CircleAvatar(child: Text('AK')),
                    title: Text('Amina Khan'),
                    subtitle: Text('STU-1042 · Grade 9'),
                  ),
                  ListTile(
                    leading: CircleAvatar(child: Text('JL')),
                    title: Text('Jordan Lee'),
                    subtitle: Text('STU-1108 · Grade 7'),
                  ),
                  ListTile(
                    leading: CircleAvatar(child: Text('MR')),
                    title: Text('Maya Rao'),
                    subtitle: Text('STU-1215 · Grade 11'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AttendanceShellPreview extends StatelessWidget {
  const _AttendanceShellPreview();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Attendance')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          const TextField(
            decoration: InputDecoration(
              labelText: 'Institution id',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          const TextField(
            decoration: InputDecoration(
              labelText: 'Class (optional)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.calendar_today_outlined),
            label: const Text('2026-09-06'),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () {},
            child: const Text('Load roster'),
          ),
          const SizedBox(height: 24),
          Card(
            child: ListTile(
              title: const Text('Offline queue'),
              subtitle: const Text('2 marks pending sync'),
              trailing: IconButton(
                icon: const Icon(Icons.cloud_upload_outlined),
                onPressed: () {},
              ),
            ),
          ),
          const ListTile(
            title: Text('Amina Khan'),
            subtitle: Text('Present'),
            trailing: Icon(Icons.check_circle_outline),
          ),
          const ListTile(
            title: Text('Jordan Lee'),
            subtitle: Text('Absent'),
            trailing: Icon(Icons.cancel_outlined),
          ),
        ],
      ),
    );
  }
}

class _InstitutionsShellPreview extends StatelessWidget {
  const _InstitutionsShellPreview();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Institutions')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: const <Widget>[
          ListTile(
            leading: Icon(Icons.apartment_outlined),
            title: Text('Greenfield High'),
            subtitle: Text('CBSE · Mumbai'),
          ),
          ListTile(
            leading: Icon(Icons.apartment_outlined),
            title: Text('Riverside Academy'),
            subtitle: Text('ICSE · Pune'),
          ),
          ListTile(
            leading: Icon(Icons.apartment_outlined),
            title: Text('North District School'),
            subtitle: Text('State · Nagpur'),
          ),
        ],
      ),
    );
  }
}

class _ScholarshipsShellPreview extends StatelessWidget {
  const _ScholarshipsShellPreview();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scholarships')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          Card(
            child: ListTile(
              title: const Text('Merit STEM 2026'),
              subtitle: const Text('Open · Applications due Sep 30'),
              trailing: FilledButton(
                onPressed: () {},
                child: const Text('Apply'),
              ),
            ),
          ),
          const Card(
            child: ListTile(
              title: Text('Need-based Aid'),
              subtitle: Text('In review · 2 docs pending'),
              trailing: Icon(Icons.hourglass_top_outlined),
            ),
          ),
        ],
      ),
    );
  }
}

class _HealthShellPreview extends StatelessWidget {
  const _HealthShellPreview();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Health records')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: const <Widget>[
          ListTile(
            leading: Icon(Icons.monitor_heart_outlined),
            title: Text('Vision screening'),
            subtitle: Text('Completed · 2026-08-12'),
          ),
          ListTile(
            leading: Icon(Icons.psychology_outlined),
            title: Text('Counselling note'),
            subtitle: Text('Confidential · staff only'),
          ),
          ListTile(
            leading: Icon(Icons.accessibility_new_outlined),
            title: Text('Special needs plan'),
            subtitle: Text('Active accommodations'),
          ),
        ],
      ),
    );
  }
}

class _ExaminationsShellPreview extends StatelessWidget {
  const _ExaminationsShellPreview();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Examinations')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: const <Widget>[
          ListTile(
            leading: Icon(Icons.assignment_outlined),
            title: Text('Term 1 Midterms'),
            subtitle: Text('Sep 15–20 · 4 papers'),
          ),
          ListTile(
            leading: Icon(Icons.assignment_turned_in_outlined),
            title: Text('Board Prelims'),
            subtitle: Text('Results published'),
          ),
        ],
      ),
    );
  }
}

class _ProfileShellPreview extends StatelessWidget {
  const _ProfileShellPreview();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          const ListTile(
            leading: CircleAvatar(child: Text('FS')),
            title: Text('Field Staff'),
            subtitle: Text('staff@demo.proctira.org'),
          ),
          const Divider(),
          const ListTile(
            leading: Icon(Icons.badge_outlined),
            title: Text('Tenant'),
            subtitle: Text('proctira-multiboard-cert'),
          ),
          ListTile(
            leading: const Icon(Icons.logout),
            title: const Text('Sign out'),
            onTap: () {},
          ),
        ],
      ),
    );
  }
}

class _NotificationsShellPreview extends StatelessWidget {
  const _NotificationsShellPreview();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: const <Widget>[
          SwitchListTile(
            value: true,
            onChanged: null,
            title: Text('Attendance sync alerts'),
            subtitle: Text('Offline queue failures'),
          ),
          SwitchListTile(
            value: false,
            onChanged: null,
            title: Text('Scholarship deadlines'),
            subtitle: Text('Program close reminders'),
          ),
          ListTile(
            leading: Icon(Icons.mark_email_unread_outlined),
            title: Text('2 unread approvals'),
            subtitle: Text('Workflow inbox'),
          ),
        ],
      ),
    );
  }
}
