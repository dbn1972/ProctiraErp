import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/injector.dart';
import '../data/transport_repository.dart';

/// Transport hub with KPI summary + links to routes/vehicles/assignments.
class TransportOverviewScreen extends StatefulWidget {
  const TransportOverviewScreen({super.key});

  @override
  State<TransportOverviewScreen> createState() =>
      _TransportOverviewScreenState();
}

class _TransportOverviewScreenState extends State<TransportOverviewScreen> {
  late Future<TransportOverview> _future;

  @override
  void initState() {
    super.initState();
    _future = getIt<TransportRepository>().getOverview();
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Transport')),
      body: RefreshIndicator(
        onRefresh: () async {
          setState(() {
            _future = getIt<TransportRepository>().getOverview();
          });
          await _future;
        },
        child: FutureBuilder<TransportOverview>(
          future: _future,
          builder:
              (BuildContext context, AsyncSnapshot<TransportOverview> snap) {
            if (snap.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            final TransportOverview data =
                snap.data ??
                    const TransportOverview(
                      routes: <TransportRoute>[],
                      vehicles: <TransportVehicle>[],
                      assignments: <StudentRouteAssignment>[],
                    );
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              children: <Widget>[
                Text(
                  'Routes, fleet and student assignments',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: <Widget>[
                    _KpiTile(
                      label: 'Active routes',
                      value: '${data.activeRouteCount}',
                      color: const Color(0xFF4F46E5),
                    ),
                    const SizedBox(width: 10),
                    _KpiTile(
                      label: 'Vehicles',
                      value: '${data.activeVehicleCount}',
                      color: const Color(0xFF14B8A6),
                    ),
                    const SizedBox(width: 10),
                    _KpiTile(
                      label: 'Assignments',
                      value: '${data.activeAssignmentCount}',
                      color: const Color(0xFF8B5CF6),
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                _NavCard(
                  icon: Icons.alt_route,
                  title: 'Routes',
                  subtitle: '${data.routes.length} configured',
                  onTap: () => context.push('/transport/routes'),
                ),
                _NavCard(
                  icon: Icons.directions_bus_outlined,
                  title: 'Vehicles',
                  subtitle: '${data.vehicles.length} in fleet',
                  onTap: () => context.push('/transport/vehicles'),
                ),
                _NavCard(
                  icon: Icons.people_outline,
                  title: 'Student assignments',
                  subtitle: '${data.assignments.length} records',
                  onTap: () => context.push('/transport/assignments'),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _KpiTile extends StatelessWidget {
  const _KpiTile({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                value,
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: color,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                label,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavCard extends StatelessWidget {
  const _NavCard({
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
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        leading: Icon(icon),
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}
