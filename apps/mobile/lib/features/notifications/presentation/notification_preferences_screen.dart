import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import '../../../core/di/injector.dart';
import '../../../core/storage/secure_storage.dart';
import '../data/local_notification_preferences.dart';

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
  LocalNotificationPreferences _prefs = const LocalNotificationPreferences();

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final String? raw =
        await getIt<SecureStorage>().readNotificationPreferences();
    if (!mounted || raw == null || raw.isEmpty) {
      return;
    }
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is Map) {
        setState(() {
          _prefs = LocalNotificationPreferences.fromJson(
            Map<String, dynamic>.from(decoded),
          );
        });
      }
    } catch (_) {
      // Keep defaults when the stored payload is unreadable.
    }
  }

  void _update(LocalNotificationPreferences next) {
    setState(() => _prefs = next);
    unawaited(_persist(announce: false));
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Notification Preferences')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: <Widget>[
          Text(
            'Stored on this device only. These choices are not saved to your account.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 16),
          _SectionHeader(title: 'Channels'),
          const SizedBox(height: 8),
          _PrefCard(
            children: <Widget>[
              _PrefSwitch(
                icon: Icons.notifications_active_outlined,
                tint: const Color(0xFF4F46E5),
                title: 'Push notifications',
                subtitle: 'Receive alerts on your device',
                value: _prefs.pushEnabled,
                onChanged: (bool value) =>
                    _update(_prefs.copyWith(pushEnabled: value)),
              ),
              _PrefSwitch(
                icon: Icons.email_outlined,
                tint: const Color(0xFF0EA5E9),
                title: 'Email notifications',
                subtitle: 'Receive alerts via email',
                value: _prefs.emailEnabled,
                onChanged: (bool value) =>
                    _update(_prefs.copyWith(emailEnabled: value)),
              ),
              _PrefSwitch(
                icon: Icons.inbox_outlined,
                tint: const Color(0xFF14B8A6),
                title: 'In-app notifications',
                subtitle: 'Show in the notification inbox',
                value: _prefs.inAppEnabled,
                onChanged: (bool value) =>
                    _update(_prefs.copyWith(inAppEnabled: value)),
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
                value: _prefs.attendanceAlerts,
                onChanged: (bool value) =>
                    _update(_prefs.copyWith(attendanceAlerts: value)),
              ),
              _PrefSwitch(
                icon: Icons.assignment_turned_in_outlined,
                tint: const Color(0xFF4F46E5),
                title: 'Workflow approvals',
                subtitle: 'Pending approval requests',
                value: _prefs.workflowApprovals,
                onChanged: (bool value) =>
                    _update(_prefs.copyWith(workflowApprovals: value)),
              ),
              _PrefSwitch(
                icon: Icons.insert_chart_outlined,
                tint: const Color(0xFF8B5CF6),
                title: 'Report ready',
                subtitle: 'When a generated report is available',
                value: _prefs.reportReady,
                onChanged: (bool value) =>
                    _update(_prefs.copyWith(reportReady: value)),
              ),
              _PrefSwitch(
                icon: Icons.school_outlined,
                tint: const Color(0xFFF59E0B),
                title: 'Exam results',
                subtitle: 'Examination result publications',
                value: _prefs.examResults,
                onChanged: (bool value) =>
                    _update(_prefs.copyWith(examResults: value)),
              ),
              _PrefSwitch(
                icon: Icons.swap_horiz_outlined,
                tint: const Color(0xFF0EA5E9),
                title: 'Student transfers',
                subtitle: 'Transfer request notifications',
                value: _prefs.studentTransfers,
                onChanged: (bool value) =>
                    _update(_prefs.copyWith(studentTransfers: value)),
              ),
              _PrefSwitch(
                icon: Icons.campaign_outlined,
                tint: const Color(0xFF64748B),
                title: 'System announcements',
                subtitle: 'Platform updates and maintenance',
                value: _prefs.systemAnnouncements,
                onChanged: (bool value) =>
                    _update(_prefs.copyWith(systemAnnouncements: value)),
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
    await _persist(announce: true);
  }

  Future<void> _persist({required bool announce}) async {
    try {
      await getIt<SecureStorage>().writeNotificationPreferences(
        jsonEncode(_prefs.toJson()),
      );
    } catch (_) {
      if (!mounted || !announce) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not save preferences on this device.'),
        ),
      );
      return;
    }
    if (!mounted || !announce) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Saved on this device. These choices are not synced to your account.',
        ),
      ),
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
