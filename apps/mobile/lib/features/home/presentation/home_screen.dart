import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_bloc.dart';
import '../../../core/di/injector.dart';
import '../../../core/tenant/tenant_provider.dart';

/// Authenticated landing screen. A welcoming header is followed by quick
/// actions and the services grid, each tile deep-linking into a feature area
/// via GoRouter.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final TenantProvider tenant = getIt<TenantProvider>();
    final ThemeData theme = Theme.of(context);
    final ColorScheme colors = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Text('Namaskar 👋'),
            if (tenant.displayName != null)
              Text(
                tenant.displayName!,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: colors.onSurfaceVariant,
                  fontWeight: FontWeight.w500,
                ),
              ),
          ],
        ),
        actions: <Widget>[
          IconButton(
            tooltip: 'Notifications',
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () => context.push('/notifications'),
          ),
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () =>
                context.read<AuthBloc>().add(const AuthLogoutRequested()),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: <Widget>[
          Text('Quick actions', style: theme.textTheme.titleMedium),
          const SizedBox(height: 12),
          Row(
            children: <Widget>[
              _QuickAction(
                icon: Icons.fact_check_outlined,
                label: 'Attendance',
                onTap: () => context.push('/attendance'),
              ),
              const SizedBox(width: 12),
              _QuickAction(
                icon: Icons.assignment_outlined,
                label: 'Marks entry',
                onTap: () => context.push('/assessments'),
              ),
              const SizedBox(width: 12),
              _QuickAction(
                icon: Icons.bar_chart_outlined,
                label: 'Reports',
                onTap: () => context.push('/reports'),
              ),
            ],
          ),
          const SizedBox(height: 28),
          Text('Services', style: theme.textTheme.titleMedium),
          const SizedBox(height: 12),
          GridView.count(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisCount: 2,
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 1.55,
            children: const <Widget>[
              _ServiceTile(
                icon: Icons.assignment_outlined,
                color: Color(0xFF4F46E5),
                title: 'Assessments',
                subtitle: 'Enter unit test & CCE marks',
                route: '/assessments',
              ),
              _ServiceTile(
                icon: Icons.description_outlined,
                color: Color(0xFF8B5CF6),
                title: 'Examinations',
                subtitle: 'Schedules, halls & results',
                route: '/examinations',
              ),
              _ServiceTile(
                icon: Icons.emoji_events_outlined,
                color: Color(0xFFF59E0B),
                title: 'Scholarships',
                subtitle: 'Apply & track for students',
                route: '/scholarships',
              ),
              _ServiceTile(
                icon: Icons.favorite_outline,
                color: Color(0xFFEF4444),
                title: 'Health records',
                subtitle: 'Screenings & immunization',
                route: '/health',
              ),
              _ServiceTile(
                icon: Icons.people_outline,
                color: Color(0xFF0EA5E9),
                title: 'Students',
                subtitle: 'Profiles & enrollment',
                route: '/students',
              ),
              _ServiceTile(
                icon: Icons.account_balance_outlined,
                color: Color(0xFF14B8A6),
                title: 'Institutions',
                subtitle: 'School profile & cluster info',
                route: '/institutions',
              ),
              _ServiceTile(
                icon: Icons.bar_chart_outlined,
                color: Color(0xFF10B981),
                title: 'Reports',
                subtitle: 'Attendance & exam PDFs',
                route: '/reports',
              ),
              _ServiceTile(
                icon: Icons.badge_outlined,
                color: Color(0xFF6366F1),
                title: 'Staff',
                subtitle: 'Directory & appraisals',
                route: '/staff',
              ),
              _ServiceTile(
                icon: Icons.directions_bus_outlined,
                color: Color(0xFF0D9488),
                title: 'Transport',
                subtitle: 'Routes, fleet & rides',
                route: '/transport',
              ),
              _ServiceTile(
                icon: Icons.account_tree_outlined,
                color: Color(0xFF7C3AED),
                title: 'Workflows',
                subtitle: 'Approvals inbox',
                route: '/workflows',
              ),
              _ServiceTile(
                icon: Icons.assignment_turned_in_outlined,
                color: Color(0xFFDB2777),
                title: 'Surveys',
                subtitle: 'Respond & track',
                route: '/surveys',
              ),
              _ServiceTile(
                icon: Icons.notifications_outlined,
                color: Color(0xFF64748B),
                title: 'Notifications',
                subtitle: 'Alerts & announcements',
                route: '/notifications',
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme colors = theme.colorScheme;
    return Expanded(
      child: Card(
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 8),
            child: Column(
              children: <Widget>[
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: colors.primary.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(icon, size: 22, color: colors.primary),
                ),
                const SizedBox(height: 10),
                Text(
                  label,
                  textAlign: TextAlign.center,
                  style: theme.textTheme.labelLarge,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ServiceTile extends StatelessWidget {
  const _ServiceTile({
    required this.icon,
    required this.color,
    required this.title,
    required this.subtitle,
    required this.route,
  });

  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final String route;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: () => context.push(route),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: <Widget>[
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(icon, size: 20, color: color),
              ),
              const SizedBox(height: 10),
              Text(
                title,
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
