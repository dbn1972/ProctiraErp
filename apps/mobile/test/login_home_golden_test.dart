import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Widget-level visual evidence for mobile chrome shells (16 shells).
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

  testWidgets('notification preferences shell golden snapshot',
      (WidgetTester tester) async {
    await snapshotShell(
      tester: tester,
      home: const _NotificationPreferencesShellPreview(),
      goldenName: 'notification_preferences_shell',
    );
  });

  testWidgets('reports shell golden snapshot', (WidgetTester tester) async {
    await snapshotShell(
      tester: tester,
      home: const _ReportsShellPreview(),
      goldenName: 'reports_shell',
    );
  });

  testWidgets('report detail shell golden snapshot', (WidgetTester tester) async {
    await snapshotShell(
      tester: tester,
      home: const _ReportDetailShellPreview(),
      goldenName: 'report_detail_shell',
    );
  });

  testWidgets('assessments shell golden snapshot', (WidgetTester tester) async {
    await snapshotShell(
      tester: tester,
      home: const _AssessmentsShellPreview(),
      goldenName: 'assessments_shell',
    );
  });

  testWidgets('tenant shell golden snapshot', (WidgetTester tester) async {
    await snapshotShell(
      tester: tester,
      home: const _TenantShellPreview(),
      goldenName: 'tenant_shell',
    );
  });

  testWidgets('student profile shell golden snapshot',
      (WidgetTester tester) async {
    await snapshotShell(
      tester: tester,
      home: const _StudentProfileShellPreview(),
      goldenName: 'student_profile_shell',
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
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: <Widget>[
          IconButton(
            icon: const Icon(Icons.tune_outlined),
            tooltip: 'Preferences',
            onPressed: () {},
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: const <Widget>[
          ListTile(
            leading: Icon(Icons.mark_email_unread_outlined),
            title: Text('2 unread approvals'),
            subtitle: Text('Workflow inbox'),
          ),
          ListTile(
            leading: Icon(Icons.fact_check_outlined),
            title: Text('Attendance sync failed'),
            subtitle: Text('3 marks still queued'),
          ),
          ListTile(
            leading: Icon(Icons.insert_chart_outlined),
            title: Text('Report ready'),
            subtitle: Text('Attendance summary · Sep 6'),
          ),
        ],
      ),
    );
  }
}

class _NotificationPreferencesShellPreview extends StatelessWidget {
  const _NotificationPreferencesShellPreview();

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Notification Preferences')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: <Widget>[
          Text(
            'CHANNELS',
            style: theme.textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w700,
              letterSpacing: 0.6,
            ),
          ),
          const SizedBox(height: 8),
          Card(
            margin: EdgeInsets.zero,
            child: Column(
              children: const <Widget>[
                SwitchListTile(
                  value: true,
                  onChanged: null,
                  secondary: Icon(Icons.notifications_active_outlined),
                  title: Text('Push notifications'),
                  subtitle: Text('Receive alerts on your device'),
                ),
                Divider(height: 1),
                SwitchListTile(
                  value: true,
                  onChanged: null,
                  secondary: Icon(Icons.email_outlined),
                  title: Text('Email notifications'),
                  subtitle: Text('Receive alerts via email'),
                ),
                Divider(height: 1),
                SwitchListTile(
                  value: true,
                  onChanged: null,
                  secondary: Icon(Icons.inbox_outlined),
                  title: Text('In-app notifications'),
                  subtitle: Text('Show in the notification inbox'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          Text(
            'CATEGORIES',
            style: theme.textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w700,
              letterSpacing: 0.6,
            ),
          ),
          const SizedBox(height: 8),
          Card(
            margin: EdgeInsets.zero,
            child: Column(
              children: const <Widget>[
                SwitchListTile(
                  value: true,
                  onChanged: null,
                  secondary: Icon(Icons.fact_check_outlined),
                  title: Text('Attendance alerts'),
                  subtitle: Text('Absence threshold warnings'),
                ),
                Divider(height: 1),
                SwitchListTile(
                  value: true,
                  onChanged: null,
                  secondary: Icon(Icons.assignment_turned_in_outlined),
                  title: Text('Workflow approvals'),
                  subtitle: Text('Pending approval requests'),
                ),
                Divider(height: 1),
                SwitchListTile(
                  value: false,
                  onChanged: null,
                  secondary: Icon(Icons.insert_chart_outlined),
                  title: Text('Report ready'),
                  subtitle: Text('When a generated report is available'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: () {},
            child: const Text('Save Preferences'),
          ),
        ],
      ),
    );
  }
}

class _ReportsShellPreview extends StatelessWidget {
  const _ReportsShellPreview();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reports')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: <Widget>[
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              color: const Color(0xFF0EA5E9).withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: const Color(0xFF0EA5E9).withValues(alpha: 0.30),
              ),
            ),
            child: const Row(
              children: <Widget>[
                Icon(Icons.info_outline, size: 18, color: Color(0xFF0EA5E9)),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Reports generate on the server. Open a quick report or a ready file.',
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'QUICK REPORTS',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.6,
                ),
          ),
          const SizedBox(height: 8),
          const ListTile(
            leading: Icon(Icons.fact_check_outlined),
            title: Text('Attendance summary'),
            subtitle: Text('Daily attendance totals across the institution.'),
          ),
          const ListTile(
            leading: Icon(Icons.people_alt_outlined),
            title: Text('Enrollment summary'),
            subtitle: Text('Enrollment counts grouped by class and grade.'),
          ),
          const SizedBox(height: 12),
          Text(
            'GENERATED REPORTS',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.6,
                ),
          ),
          const SizedBox(height: 8),
          const ListTile(
            leading: Icon(Icons.description_outlined),
            title: Text('Board enrollment export'),
            subtitle: Text('Ready · CSV'),
          ),
        ],
      ),
    );
  }
}

class _ReportDetailShellPreview extends StatelessWidget {
  const _ReportDetailShellPreview();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Attendance summary')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          const ListTile(
            leading: Icon(Icons.fact_check_outlined),
            title: Text('Attendance summary'),
            subtitle: Text('Daily attendance totals across the institution.'),
          ),
          const Divider(),
          const ListTile(
            leading: Icon(Icons.schedule_outlined),
            title: Text('Status'),
            subtitle: Text('Ready to generate'),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.play_arrow_outlined),
            label: const Text('Generate report'),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () {},
            icon: const Icon(Icons.download_outlined),
            label: const Text('Download last export'),
          ),
        ],
      ),
    );
  }
}

class _AssessmentsShellPreview extends StatelessWidget {
  const _AssessmentsShellPreview();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Assessments')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: const <Widget>[
          ListTile(
            leading: Icon(Icons.grade_outlined),
            title: Text('Mathematics · Term 1'),
            subtitle: Text('82% · Continuous assessment'),
          ),
          ListTile(
            leading: Icon(Icons.grade_outlined),
            title: Text('Science · Term 1'),
            subtitle: Text('74% · Continuous assessment'),
          ),
          ListTile(
            leading: Icon(Icons.grade_outlined),
            title: Text('English · Term 1'),
            subtitle: Text('88% · Continuous assessment'),
          ),
        ],
      ),
    );
  }
}

class _TenantShellPreview extends StatelessWidget {
  const _TenantShellPreview();

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Container(
                width: 54,
                height: 54,
                decoration: BoxDecoration(
                  color: colors.primary,
                  borderRadius: BorderRadius.circular(18),
                ),
                child: const Center(
                  child: Text(
                    'P',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 24,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              Text(
                'Select tenant',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 8),
              const Text('Enter the school or board tenant to continue.'),
              const SizedBox(height: 24),
              const TextField(
                decoration: InputDecoration(
                  labelText: 'Tenant id',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              const TextField(
                decoration: InputDecoration(
                  labelText: 'Display name (optional)',
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
    );
  }
}

class _StudentProfileShellPreview extends StatelessWidget {
  const _StudentProfileShellPreview();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Student profile')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          const ListTile(
            leading: CircleAvatar(child: Text('AK')),
            title: Text('Amina Khan'),
            subtitle: Text('STU-1042 · Grade 9'),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.history_edu_outlined),
            title: const Text('Enrollment history'),
            onTap: () {},
          ),
          ListTile(
            leading: const Icon(Icons.document_scanner_outlined),
            title: const Text('Capture document'),
            onTap: () {},
          ),
          ListTile(
            leading: const Icon(Icons.monitor_heart_outlined),
            title: const Text('Health records'),
            onTap: () {},
          ),
        ],
      ),
    );
  }
}
