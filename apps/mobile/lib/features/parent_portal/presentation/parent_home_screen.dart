import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// First-class parent portal home (separate from staff-leaning HomeScreen).
///
/// Staff MobileShell / HomeScreen quick actions remain teacher/clerk oriented.
/// Guardians land here via `/parent` routes.
class ParentHomeScreen extends StatelessWidget {
  const ParentHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Parent portal'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          Text(
            'Your school connection',
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            'Message the school, respond to consent requests, and pay fees. '
            'Staff attendance and roster tools stay on the main home screen.',
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: 24),
          _ParentTile(
            icon: Icons.chat_bubble_outline,
            title: 'Messages',
            subtitle: 'Two-way threads with the school',
            onTap: () => context.push('/parent/messages'),
          ),
          _ParentTile(
            icon: Icons.verified_user_outlined,
            title: 'Consents',
            subtitle: 'Photo, medical, trip approvals',
            onTap: () => context.push('/parent/consents'),
          ),
          _ParentTile(
            icon: Icons.payments_outlined,
            title: 'Fees',
            subtitle: 'Invoices and sandbox pay',
            onTap: () => context.push('/parent/fees'),
          ),
        ],
      ),
    );
  }
}

class _ParentTile extends StatelessWidget {
  const _ParentTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        minVerticalPadding: 16,
        leading: Icon(icon),
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}
