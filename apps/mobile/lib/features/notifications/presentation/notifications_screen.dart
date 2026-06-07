import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:openemis_api_client/openemis_api_client.dart';

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
                        const Icon(Icons.notifications_none, size: 56),
                        const SizedBox(height: 12),
                        Text(
                          'No notifications yet',
                          style: theme.textTheme.titleMedium,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Pull down to refresh.',
                          style: theme.textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                ],
              );
            }
            return ListView.separated(
              itemCount: items.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (BuildContext context, int index) {
                final CachedNotification item = items[index];
                final DateTime when = DateTime.fromMillisecondsSinceEpoch(
                  item.receivedAt,
                );
                return ListTile(
                  leading: CircleAvatar(
                    backgroundColor: item.read
                        ? theme.colorScheme.surfaceContainerHighest
                        : theme.colorScheme.primaryContainer,
                    child: Icon(
                      _iconFor(item.type),
                      color: item.read
                          ? theme.colorScheme.onSurfaceVariant
                          : theme.colorScheme.onPrimaryContainer,
                    ),
                  ),
                  title: Text(
                    item.title ?? 'Notification',
                    style: TextStyle(
                      fontWeight:
                          item.read ? FontWeight.w400 : FontWeight.w600,
                    ),
                  ),
                  subtitle: Text(
                    item.body ?? '',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  trailing: Text(
                    DateFormat.MMMd().add_jm().format(when),
                    style: theme.textTheme.bodySmall,
                  ),
                  onTap: () => _onTap(item),
                );
              },
            );
          },
        ),
      ),
    );
  }

  IconData _iconFor(String? type) {
    switch (type) {
      case 'ATTENDANCE_THRESHOLD':
        return Icons.fact_check_outlined;
      case 'WORKFLOW_APPROVAL':
        return Icons.assignment_turned_in_outlined;
      case 'REPORT_READY':
        return Icons.insert_chart_outlined;
      default:
        return Icons.notifications_active_outlined;
    }
  }
}
