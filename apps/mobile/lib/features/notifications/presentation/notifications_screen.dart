import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:proctira_api_client/proctira_api_client.dart';

import '../../../core/di/injector.dart';
import '../../../core/notifications/notification_router.dart';
import '../../../core/sync/connectivity_monitor.dart';
import '../data/notification_repository.dart';

/// `/notifications` route — lists cached notifications with read/unread
/// state. Tapping an item marks it read and deep-links to the relevant
/// screen via [NotificationRouter]. Pull-to-refresh fetches the latest
/// notifications from the backend when the device is online.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  late final NotificationRepository _repository;
  late final NotificationDeviceApi _deviceApi;
  late final NotificationRouter _router;
  late final ConnectivityMonitor _connectivity;

  late Future<List<CachedNotification>> _future;

  @override
  void initState() {
    super.initState();
    _repository = getIt<NotificationRepository>();
    _deviceApi = getIt<NotificationDeviceApi>();
    _router = getIt<NotificationRouter>();
    _connectivity = getIt<ConnectivityMonitor>();
    _future = _repository.listAll();
  }

  Future<void> _refresh() async {
    if (await _connectivity.isOnline()) {
      try {
        final List<Map<String, dynamic>> remote =
            await _deviceApi.listNotifications();
        if (remote.isNotEmpty) {
          await _repository.replaceWith(remote);
        }
      } catch (_) {
        // Skip silently when offline / endpoint unavailable.
      }
    }
    if (!mounted) return;
    setState(() {
      _future = _repository.listAll();
    });
  }

  Future<void> _onTap(CachedNotification item) async {
    await _repository.markRead(item.id);
    if (!mounted) return;
    final String route = _router.routeFor(item.payload);
    context.push(route);
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: <Widget>[
          IconButton(
            tooltip: 'Notification preferences',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => context.push('/notifications/preferences'),
          ),
          IconButton(
            tooltip: 'Mark all as read',
            icon: const Icon(Icons.done_all),
            onPressed: () async {
              await _repository.markAllRead();
              if (!mounted) return;
              setState(() => _future = _repository.listAll());
            },
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<CachedNotification>>(
          future: _future,
          builder: (BuildContext context,
              AsyncSnapshot<List<CachedNotification>> snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            final List<CachedNotification> items =
                snapshot.data ?? const <CachedNotification>[];
            if (items.isEmpty) {
              return ListView(
                children: <Widget>[
                  const SizedBox(height: 120),
                  Center(
                    child: Column(
                      children: <Widget>[
                        Container(
                          width: 72,
                          height: 72,
                          decoration: BoxDecoration(
                            color: theme.colorScheme.primary
                                .withValues(alpha: 0.12),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            Icons.notifications_none,
                            size: 36,
                            color: theme.colorScheme.primary,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          'No notifications yet',
                          style: theme.textTheme.titleMedium,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Pull down to refresh.',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              itemCount: items.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (BuildContext context, int index) {
                final CachedNotification item = items[index];
                final DateTime when = DateTime.fromMillisecondsSinceEpoch(
                  item.receivedAt,
                );
                final (Color tint, IconData icon) = _styleFor(item.type);
                return _NotificationCard(
                  icon: icon,
                  tint: tint,
                  title: item.title ?? 'Notification',
                  body: item.body ?? '',
                  time: _relativeTime(when),
                  unread: !item.read,
                  onTap: () => _onTap(item),
                );
              },
            );
          },
        ),
      ),
    );
  }

  (Color, IconData) _styleFor(String? type) {
    switch (type) {
      case 'ATTENDANCE_THRESHOLD':
        return (const Color(0xFF10B981), Icons.fact_check_outlined);
      case 'WORKFLOW_APPROVAL':
        return (
          const Color(0xFF4F46E5),
          Icons.assignment_turned_in_outlined
        );
      case 'REPORT_READY':
        return (const Color(0xFF8B5CF6), Icons.insert_chart_outlined);
      default:
        return (const Color(0xFF64748B), Icons.notifications_active_outlined);
    }
  }

  /// Human-friendly relative time, falling back to an absolute date/time.
  String _relativeTime(DateTime when) {
    final Duration diff = DateTime.now().difference(when);
    if (diff.inMinutes < 1) return 'now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return DateFormat.MMMd().add_jm().format(when);
  }
}

/// A single notification card: tinted category icon, title, body snippet,
/// relative time and an unread indicator dot.
class _NotificationCard extends StatelessWidget {
  const _NotificationCard({
    required this.icon,
    required this.tint,
    required this.title,
    required this.body,
    required this.time,
    required this.unread,
    required this.onTap,
  });

  final IconData icon;
  final Color tint;
  final String title;
  final String body;
  final String time;
  final bool unread;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      color: unread
          ? theme.colorScheme.primary.withValues(alpha: 0.06)
          : null,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: tint.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, size: 20, color: tint),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      title,
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight:
                            unread ? FontWeight.w700 : FontWeight.w600,
                      ),
                    ),
                    if (body.isNotEmpty) ...<Widget>[
                      const SizedBox(height: 2),
                      Text(
                        body,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                    const SizedBox(height: 6),
                    Text(
                      time,
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              if (unread)
                Container(
                  width: 8,
                  height: 8,
                  margin: const EdgeInsets.only(top: 6),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primary,
                    shape: BoxShape.circle,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
