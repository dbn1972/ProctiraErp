import 'package:flutter/material.dart';

/// `/notifications/preferences` route — allows users to configure which
/// notification channels and categories they want to receive push
/// notifications for.
class NotificationPreferencesScreen extends StatefulWidget {
  const NotificationPreferencesScreen({super.key});

  @override
  State<NotificationPreferencesScreen> createState() =>
      _NotificationPreferencesScreenState();
}

class _NotificationPreferencesScreenState
    extends State<NotificationPreferencesScreen> {
  // Channel toggles.
  bool _pushEnabled = true;
  bool _emailEnabled = true;
  bool _inAppEnabled = true;

  // Category toggles.
  bool _attendanceAlerts = true;
  bool _workflowApprovals = true;
  bool _reportReady = true;
  bool _examResults = true;
  bool _studentTransfers = true;
  bool _systemAnnouncements = true;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notification Preferences')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: <Widget>[
          _SectionHeader(title: 'Channels'),
          const SizedBox(height: 8),
          _PrefCard(
            children: <Widget>[
              _PrefSwitch(
                icon: Icons.notifications_active_outlined,
                tint: const Color(0xFF4F46E5),
                title: 'Push notifications',
                subtitle: 'Receive alerts on your device',
                value: _pushEnabled,
                onChanged: (bool value) =>
                    setState(() => _pushEnabled = value),
              ),
              _PrefSwitch(
                icon: Icons.email_outlined,
                tint: const Color(0xFF0EA5E9),
                title: 'Email notifications',
                subtitle: 'Receive alerts via email',
                value: _emailEnabled,
                onChanged: (bool value) =>
                    setState(() => _emailEnabled = value),
              ),
              _PrefSwitch(
                icon: Icons.inbox_outlined,
                tint: const Color(0xFF14B8A6),
                title: 'In-app notifications',
                subtitle: 'Show in the notification inbox',
                value: _inAppEnabled,
                onChanged: (bool value) =>
                    setState(() => _inAppEnabled = value),
              ),
            ],
          ),
          const SizedBox(height: 20),
          _SectionHeader(title: 'Categories'),
          const SizedBox(height: 8),
          _PrefCard(
            children: <Widget>[
              _PrefSwitch(
                icon: Icons.fact_check_outlined,
                tint: const Color(0xFF10B981),
                title: 'Attendance alerts',
                subtitle: 'Absence threshold warnings',
                value: _attendanceAlerts,
                onChanged: (bool value) =>
                    setState(() => _attendanceAlerts = value),
              ),
              _PrefSwitch(
                icon: Icons.assignment_turned_in_outlined,
                tint: const Color(0xFF4F46E5),
                title: 'Workflow approvals',
                subtitle: 'Pending approval requests',
                value: _workflowApprovals,
                onChanged: (bool value) =>
                    setState(() => _workflowApprovals = value),
              ),
              _PrefSwitch(
                icon: Icons.insert_chart_outlined,
                tint: const Color(0xFF8B5CF6),
                title: 'Report ready',
                subtitle: 'When a generated report is available',
                value: _reportReady,
                onChanged: (bool value) =>
                    setState(() => _reportReady = value),
              ),
              _PrefSwitch(
                icon: Icons.school_outlined,
                tint: const Color(0xFFF59E0B),
                title: 'Exam results',
                subtitle: 'Examination result publications',
                value: _examResults,
                onChanged: (bool value) =>
                    setState(() => _examResults = value),
              ),
              _PrefSwitch(
                icon: Icons.swap_horiz_outlined,
                tint: const Color(0xFF0EA5E9),
                title: 'Student transfers',
                subtitle: 'Transfer request notifications',
                value: _studentTransfers,
                onChanged: (bool value) =>
                    setState(() => _studentTransfers = value),
              ),
              _PrefSwitch(
                icon: Icons.campaign_outlined,
                tint: const Color(0xFF64748B),
                title: 'System announcements',
                subtitle: 'Platform updates and maintenance',
                value: _systemAnnouncements,
                onChanged: (bool value) =>
                    setState(() => _systemAnnouncements = value),
              ),
            ],
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _savePreferences,
            child: const Text('Save Preferences'),
          ),
        ],
      ),
    );
  }

  Future<void> _savePreferences() async {
    // In a production app this would call the backend API to persist
    // preferences. For now we show a confirmation snackbar.
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Preferences saved')),
    );
  }
}

/// Uppercase, tracked section label.
class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});
  final String title;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Text(
      title.toUpperCase(),
      style: theme.textTheme.labelSmall?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: 0.6,
        color: theme.colorScheme.onSurfaceVariant,
      ),
    );
  }
}

/// A rounded card that stacks preference rows with hairline dividers.
class _PrefCard extends StatelessWidget {
  const _PrefCard({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final List<Widget> rows = <Widget>[];
    for (int i = 0; i < children.length; i++) {
      if (i > 0) rows.add(const Divider(height: 1));
      rows.add(children[i]);
    }
    return Card(
      margin: EdgeInsets.zero,
      child: Column(children: rows),
    );
  }
}

/// A preference toggle row: tinted leading icon, title + subtitle, switch.
class _PrefSwitch extends StatelessWidget {
  const _PrefSwitch({
    required this.icon,
    required this.tint,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  final IconData icon;
  final Color tint;
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return SwitchListTile(
      contentPadding:
          const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      secondary: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: tint.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Icon(icon, size: 20, color: tint),
      ),
      title: Text(title),
      subtitle: Text(subtitle),
      value: value,
      onChanged: onChanged,
    );
  }
}
