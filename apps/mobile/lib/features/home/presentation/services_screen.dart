import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Full-screen services directory matching `redesign/mobile/services.html`.
///
/// Two-column tile grid of deep links into domain features. The home screen
/// embeds a similar grid; this route is the dedicated tab destination.
class ServicesScreen extends StatelessWidget {
  const ServicesScreen({super.key});

  static const List<_ServiceItem> _items = <_ServiceItem>[
    _ServiceItem(
      icon: Icons.assignment_outlined,
      color: Color(0xFF4F46E5),
      title: 'Assessments',
      subtitle: 'Enter unit test & CCE marks',
      route: '/assessments',
    ),
    _ServiceItem(
      icon: Icons.description_outlined,
      color: Color(0xFF8B5CF6),
      title: 'Examinations',
      subtitle: 'Schedules, halls & results',
      route: '/examinations',
    ),
    _ServiceItem(
      icon: Icons.emoji_events_outlined,
      color: Color(0xFFF59E0B),
      title: 'Scholarships',
      subtitle: 'Apply & track for students',
      route: '/scholarships',
    ),
    _ServiceItem(
      icon: Icons.favorite_outline,
      color: Color(0xFFEF4444),
      title: 'Health records',
      subtitle: 'Screenings & immunization',
      route: '/health',
    ),
    _ServiceItem(
      icon: Icons.document_scanner_outlined,
      color: Color(0xFF0EA5E9),
      title: 'Documents scan',
      subtitle: 'Capture certificates offline',
      route: '/students',
    ),
    _ServiceItem(
      icon: Icons.account_balance_outlined,
      color: Color(0xFF14B8A6),
      title: 'Institutions',
      subtitle: 'School profile & cluster info',
      route: '/institutions',
    ),
    _ServiceItem(
      icon: Icons.bar_chart_outlined,
      color: Color(0xFF10B981),
      title: 'Reports',
      subtitle: 'Attendance & exam PDFs',
      route: '/reports',
    ),
    _ServiceItem(
      icon: Icons.badge_outlined,
      color: Color(0xFF6366F1),
      title: 'Staff',
      subtitle: 'Directory, appraisals & training',
      route: '/staff',
    ),
    _ServiceItem(
      icon: Icons.directions_bus_outlined,
      color: Color(0xFF0D9488),
      title: 'Transport',
      subtitle: 'Routes, fleet & assignments',
      route: '/transport',
    ),
    _ServiceItem(
      icon: Icons.account_tree_outlined,
      color: Color(0xFF7C3AED),
      title: 'Workflows',
      subtitle: 'Definitions, instances & approvals',
      route: '/workflows',
    ),
    _ServiceItem(
      icon: Icons.assignment_turned_in_outlined,
      color: Color(0xFFDB2777),
      title: 'Surveys',
      subtitle: 'Respond to school surveys',
      route: '/surveys',
    ),
    _ServiceItem(
      icon: Icons.history,
      color: Color(0xFF64748B),
      title: 'Enrollment history',
      subtitle: 'Admissions & transfers',
      route: '/students',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Text('Services'),
            Text(
              'School operations',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: <Widget>[
          GridView.count(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisCount: 2,
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 1.35,
            children: _items
                .map(
                  (_ServiceItem item) => _ServiceTile(item: item),
                )
                .toList(growable: false),
          ),
        ],
      ),
    );
  }
}

class _ServiceItem {
  const _ServiceItem({
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
}

class _ServiceTile extends StatelessWidget {
  const _ServiceTile({required this.item});

  final _ServiceItem item;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: () => context.push(item.route),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: item.color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(item.icon, size: 20, color: item.color),
              ),
              const Spacer(),
              Text(
                item.title,
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                item.subtitle,
                maxLines: 2,
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
