import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/injector.dart';
import '../data/transport_repository.dart';

class TransportRoutesScreen extends StatefulWidget {
  const TransportRoutesScreen({super.key});

  @override
  State<TransportRoutesScreen> createState() => _TransportRoutesScreenState();
}

class _TransportRoutesScreenState extends State<TransportRoutesScreen> {
  late Future<List<TransportRoute>> _future;

  @override
  void initState() {
    super.initState();
    _future = getIt<TransportRepository>().listRoutes();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Routes')),
      body: FutureBuilder<List<TransportRoute>>(
        future: _future,
        builder:
            (BuildContext context, AsyncSnapshot<List<TransportRoute>> snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final List<TransportRoute> routes =
              snap.data ?? const <TransportRoute>[];
          if (routes.isEmpty) {
            return const Center(child: Text('No routes configured'));
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            itemCount: routes.length,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (BuildContext context, int index) {
              final TransportRoute route = routes[index];
              return Card(
                child: ListTile(
                  title: Text(route.name),
                  subtitle: Text(
                    '${route.startLocation} → ${route.endLocation}',
                  ),
                  trailing: Text(
                    route.status,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  onTap: () => context.push('/transport/routes/${route.id}'),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class TransportRouteDetailScreen extends StatefulWidget {
  const TransportRouteDetailScreen({super.key, required this.routeId});

  final String routeId;

  @override
  State<TransportRouteDetailScreen> createState() =>
      _TransportRouteDetailScreenState();
}

class _TransportRouteDetailScreenState
    extends State<TransportRouteDetailScreen> {
  late Future<({TransportRoute? route, List<TransportStop> stops})> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<({TransportRoute? route, List<TransportStop> stops})> _load() async {
    final TransportRepository repo = getIt<TransportRepository>();
    final TransportRoute? route = await repo.getRoute(widget.routeId);
    final List<TransportStop> stops = await repo.listStops(widget.routeId);
    return (route: route, stops: stops);
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Route detail')),
      body: FutureBuilder<({TransportRoute? route, List<TransportStop> stops})>(
        future: _future,
        builder: (BuildContext context, AsyncSnapshot<({TransportRoute? route, List<TransportStop> stops})> snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final TransportRoute? route = snap.data?.route;
          final List<TransportStop> stops =
              snap.data?.stops ?? const <TransportStop>[];
          if (route == null) {
            return const Center(child: Text('Route not found'));
          }
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            children: <Widget>[
              Text(route.name, style: theme.textTheme.headlineSmall),
              const SizedBox(height: 6),
              Text(
                '${route.startLocation} → ${route.endLocation}',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 12),
              Card(
                child: Column(
                  children: <Widget>[
                    ListTile(
                      title: const Text('Status'),
                      trailing: Text(route.status),
                    ),
                    ListTile(
                      title: const Text('Departure'),
                      trailing: Text(route.departureTime ?? '—'),
                    ),
                    ListTile(
                      title: const Text('Return'),
                      trailing: Text(route.returnTime ?? '—'),
                    ),
                    ListTile(
                      title: const Text('Distance'),
                      trailing: Text(
                        route.distanceKm != null
                            ? '${route.distanceKm} km'
                            : '—',
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Text('Stops', style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              if (stops.isEmpty)
                const Card(child: ListTile(title: Text('No stops listed')))
              else
                ...stops.map(
                  (TransportStop s) => Card(
                    child: ListTile(
                      leading: CircleAvatar(
                        radius: 14,
                        child: Text('${s.stopOrder}'),
                      ),
                      title: Text(s.name),
                      subtitle: Text(
                        <String>[
                          if (s.pickupTime != null) 'Pickup ${s.pickupTime}',
                          if (s.dropoffTime != null) 'Drop ${s.dropoffTime}',
                        ].join(' · '),
                      ),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class TransportVehiclesScreen extends StatefulWidget {
  const TransportVehiclesScreen({super.key});

  @override
  State<TransportVehiclesScreen> createState() =>
      _TransportVehiclesScreenState();
}

class _TransportVehiclesScreenState extends State<TransportVehiclesScreen> {
  late Future<List<TransportVehicle>> _future;

  @override
  void initState() {
    super.initState();
    _future = getIt<TransportRepository>().listVehicles();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Vehicles')),
      body: FutureBuilder<List<TransportVehicle>>(
        future: _future,
        builder: (BuildContext context,
            AsyncSnapshot<List<TransportVehicle>> snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final List<TransportVehicle> vehicles =
              snap.data ?? const <TransportVehicle>[];
          if (vehicles.isEmpty) {
            return const Center(child: Text('No vehicles in fleet'));
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            itemCount: vehicles.length,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (BuildContext context, int index) {
              final TransportVehicle v = vehicles[index];
              return Card(
                child: ListTile(
                  leading: const Icon(Icons.directions_bus_outlined),
                  title: Text(v.registrationNumber),
                  subtitle: Text(
                    <String>[
                      if (v.make != null || v.model != null)
                        <String>[
                          if (v.make != null) v.make!,
                          if (v.model != null) v.model!,
                        ].join(' '),
                      'Cap ${v.capacity}',
                      v.status,
                      if (v.insuranceExpiry != null)
                        'Ins ${v.insuranceExpiry}',
                    ].join(' · '),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class TransportAssignmentsScreen extends StatefulWidget {
  const TransportAssignmentsScreen({super.key});

  @override
  State<TransportAssignmentsScreen> createState() =>
      _TransportAssignmentsScreenState();
}

class _TransportAssignmentsScreenState
    extends State<TransportAssignmentsScreen> {
  late Future<List<StudentRouteAssignment>> _future;

  @override
  void initState() {
    super.initState();
    _future = getIt<TransportRepository>().listAssignments();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Assignments')),
      body: FutureBuilder<List<StudentRouteAssignment>>(
        future: _future,
        builder: (BuildContext context,
            AsyncSnapshot<List<StudentRouteAssignment>> snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final List<StudentRouteAssignment> items =
              snap.data ?? const <StudentRouteAssignment>[];
          if (items.isEmpty) {
            return const Center(child: Text('No student assignments'));
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            itemCount: items.length,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (BuildContext context, int index) {
              final StudentRouteAssignment a = items[index];
              return Card(
                child: ListTile(
                  title: Text('Student ${a.studentId}'),
                  subtitle: Text(
                    <String>[
                      'Route ${a.routeId}',
                      if (a.stopId != null) 'Stop ${a.stopId}',
                      'From ${a.startDate}',
                      a.isActive ? 'Active' : 'Inactive',
                    ].join(' · '),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
