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
        children: <Widget>[
          _SectionHeader(title: 'Channels'),
          SwitchListTile(
            title: const Text('Push notifications'),
            subtitle: const Text('Receive alerts on your device'),
            secondary: const Icon(Icons.notifications_active),
            value: _pushEnabled,
            onChanged: (bool value) =>
                setState(() => _pushEnabled = value),
          ),
          SwitchListTile(
            title: const Text('Email notifications'),
            subtitle: const Text('Receive alerts via email'),
            secondary: const Icon(Icons.email_outlined),
            value: _emailEnabled,
            onChanged: (bool value) =>
                setState(() => _emailEnabled = value),
          ),
          SwitchListTile(
            title: const Text('In-app notifications'),
            subtitle: const Text('Show in the notification inbox'),
            secondary: const Icon(Icons.inbox_outlined),
            value: _inAppEnabled,
            onChanged: (bool value) =>
                setState(() => _inAppEnabled = value),
          ),
          const Divider(),
          _SectionHeader(title: 'Categories'),
          SwitchListTile(
            title: const Text('Attendance alerts'),
            subtitle: const Text('Absence threshold warnings'),
            value: _attendanceAlerts,
            onChanged: (bool value) =>
                setState(() => _attendanceAlerts = value),
          ),
          SwitchListTile(
            title: const Text('Workflow approvals'),
            subtitle: const Text('Pending approval requests'),
            value: _workflowApprovals,
            onChanged: (bool value) =>
                setState(() => _workflowApprovals = value),
          ),
          SwitchListTile(
            title: const Text('Report ready'),
            subtitle: const Text('When a generated report is available'),
            value: _reportReady,
            onChanged: (bool value) =>
                setState(() => _reportReady = value),
          ),
          SwitchListTile(
            title: const Text('Exam results'),
            subtitle: const Text('Examination result publications'),
            value: _examResults,
            onChanged: (bool value) =>
                setState(() => _examResults = value),
          ),
          SwitchListTile(
            title: const Text('Student transfers'),
            subtitle: const Text('Transfer request notifications'),
            value: _studentTransfers,
            onChanged: (bool value) =>
                setState(() => _studentTransfers = value),
          ),
          SwitchListTile(
            title: const Text('System announcements'),
            subtitle: const Text('Platform updates and maintenance'),
            value: _systemAnnouncements,
            onChanged: (bool value) =>
                setState(() => _systemAnnouncements = value),
          ),
          const SizedBox(height: 16),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: FilledButton(
              onPressed: _savePreferences,
              child: const Text('Save Preferences'),
            ),
          ),
          const SizedBox(height: 32),
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

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});
  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: Theme.of(context).colorScheme.primary,
            ),
      ),
    );
  }
}
