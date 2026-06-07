import 'package:flutter/material.dart';
import 'package:openemis_api_client/openemis_api_client.dart';

import '../../../core/di/injector.dart';
import '../../../core/sync/connectivity_monitor.dart';
import '../data/institution_repository.dart';

/// `/institutions/:id` route — shows detailed info for a single institution
/// organised into tabs: Overview, Contact, Academic Periods, Infrastructure.
class InstitutionDetailScreen extends StatefulWidget {
  const InstitutionDetailScreen({super.key, required this.id});

  final String id;

  @override
  State<InstitutionDetailScreen> createState() =>
      _InstitutionDetailScreenState();
}

class _InstitutionDetailScreenState extends State<InstitutionDetailScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  late final InstitutionRepository _cache;
  late final InstitutionApi _api;
  late final ConnectivityMonitor _connectivity;

  late Future<CachedInstitution?> _institutionFuture;
  Future<Map<String, dynamic>>? _contactFuture;
  Future<List<Map<String, dynamic>>>? _periodsFuture;
  Future<List<Map<String, dynamic>>>? _infrastructureFuture;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _cache = getIt<InstitutionRepository>();
    _api = getIt<InstitutionApi>();
    _connectivity = getIt<ConnectivityMonitor>();
    _institutionFuture = _cache.findById(widget.id);
    _loadRemoteData();
  }

  Future<void> _loadRemoteData() async {
    if (await _connectivity.isOnline()) {
      setState(() {
        _contactFuture = _api.fetchContactInfo(widget.id);
        _periodsFuture = _api.fetchAcademicPeriods(widget.id);
        _infrastructureFuture = _api.fetchInfrastructure(widget.id);
      });
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Institution'),
        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
          tabs: const <Widget>[
            Tab(text: 'Overview'),
            Tab(text: 'Contact'),
            Tab(text: 'Periods'),
            Tab(text: 'Infrastructure'),
          ],
        ),
      ),
      body: FutureBuilder<CachedInstitution?>(
        future: _institutionFuture,
        builder: (BuildContext context,
            AsyncSnapshot<CachedInstitution?> snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          final CachedInstitution? institution = snapshot.data;
          if (institution == null) {
            return _buildNotFound(context);
          }
          return TabBarView(
            controller: _tabController,
            children: <Widget>[
              _OverviewTab(institution: institution),
              _ContactTab(future: _contactFuture, institution: institution),
              _AcademicPeriodsTab(future: _periodsFuture),
              _InfrastructureTab(future: _infrastructureFuture),
            ],
          );
        },
      ),
    );
  }

  Widget _buildNotFound(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Icon(Icons.search_off, size: 56),
            const SizedBox(height: 12),
            Text(
              'Institution not cached yet.',
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              'Connect to the network from the institutions list to fetch it.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

/// Overview tab showing basic institution details.
class _OverviewTab extends StatelessWidget {
  const _OverviewTab({required this.institution});
  final CachedInstitution institution;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    CircleAvatar(
                      radius: 28,
                      backgroundColor: theme.colorScheme.primaryContainer,
                      child: Icon(
                        Icons.school,
                        size: 28,
                        color: theme.colorScheme.onPrimaryContainer,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(
                            institution.name,
                            style: theme.textTheme.titleLarge,
                          ),
                          if (institution.code != null)
                            Text(
                              'Code: ${institution.code}',
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
                if (institution.status != null) ...<Widget>[
                  const SizedBox(height: 12),
                  Chip(
                    label: Text(institution.status!),
                    backgroundColor:
                        institution.status == 'active'
                            ? Colors.green.shade50
                            : Colors.orange.shade50,
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        _InfoSection(
          title: 'Classification',
          rows: <_InfoRow>[
            _InfoRow(label: 'Type', value: institution.type),
            _InfoRow(label: 'Sector', value: institution.sector),
            _InfoRow(label: 'Ownership', value: institution.ownership),
          ],
        ),
        const SizedBox(height: 12),
        _InfoSection(
          title: 'Location',
          rows: <_InfoRow>[
            _InfoRow(label: 'Area ID', value: institution.areaId),
          ],
        ),
      ],
    );
  }
}

/// Contact tab showing phone, email, address fetched from the API.
class _ContactTab extends StatelessWidget {
  const _ContactTab({required this.future, required this.institution});
  final Future<Map<String, dynamic>>? future;
  final CachedInstitution institution;

  @override
  Widget build(BuildContext context) {
    if (future == null) {
      return const _OfflinePlaceholder(
        message: 'Contact information requires an internet connection.',
      );
    }
    return FutureBuilder<Map<String, dynamic>>(
      future: future,
      builder:
          (BuildContext context, AsyncSnapshot<Map<String, dynamic>> snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return _OfflinePlaceholder(
            message: 'Failed to load contact info: ${snapshot.error}',
          );
        }
        final Map<String, dynamic> data =
            snapshot.data ?? const <String, dynamic>{};
        return ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            _InfoSection(
              title: 'Contact Details',
              rows: <_InfoRow>[
                _InfoRow(
                  label: 'Phone',
                  value: data['contactPhone'] as String?,
                ),
                _InfoRow(
                  label: 'Email',
                  value: data['contactEmail'] as String?,
                ),
                _InfoRow(
                  label: 'Website',
                  value: data['website'] as String?,
                ),
              ],
            ),
            const SizedBox(height: 12),
            _InfoSection(
              title: 'Address',
              rows: <_InfoRow>[
                _InfoRow(
                  label: 'Address',
                  value: data['address'] as String?,
                ),
                _InfoRow(
                  label: 'City',
                  value: data['city'] as String?,
                ),
                _InfoRow(
                  label: 'State',
                  value: data['state'] as String?,
                ),
                _InfoRow(
                  label: 'Postal Code',
                  value: data['postalCode'] as String?,
                ),
              ],
            ),
            const SizedBox(height: 12),
            _InfoSection(
              title: 'Coordinates',
              rows: <_InfoRow>[
                _InfoRow(
                  label: 'Latitude',
                  value: data['latitude']?.toString(),
                ),
                _InfoRow(
                  label: 'Longitude',
                  value: data['longitude']?.toString(),
                ),
              ],
            ),
          ],
        );
      },
    );
  }
}

/// Academic periods tab showing configured periods for the institution.
class _AcademicPeriodsTab extends StatelessWidget {
  const _AcademicPeriodsTab({required this.future});
  final Future<List<Map<String, dynamic>>>? future;

  @override
  Widget build(BuildContext context) {
    if (future == null) {
      return const _OfflinePlaceholder(
        message: 'Academic periods require an internet connection.',
      );
    }
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: future,
      builder: (BuildContext context,
          AsyncSnapshot<List<Map<String, dynamic>>> snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return _OfflinePlaceholder(
            message: 'Failed to load periods: ${snapshot.error}',
          );
        }
        final List<Map<String, dynamic>> periods =
            snapshot.data ?? const <Map<String, dynamic>>[];
        if (periods.isEmpty) {
          return const _OfflinePlaceholder(
            message: 'No academic periods configured.',
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: periods.length,
          separatorBuilder: (_, _) => const SizedBox(height: 8),
          itemBuilder: (BuildContext context, int index) {
            final Map<String, dynamic> period = periods[index];
            final String name =
                (period['name'] as String?) ?? 'Period ${index + 1}';
            final String? startDate = period['startDate'] as String?;
            final String? endDate = period['endDate'] as String?;
            final bool isActive = period['isActive'] == true;
            return Card(
              child: ListTile(
                leading: Icon(
                  isActive ? Icons.calendar_today : Icons.calendar_month,
                  color: isActive ? Colors.green : null,
                ),
                title: Text(name),
                subtitle: Text(
                  <String>[
                    if (startDate != null) 'Start: $startDate',
                    if (endDate != null) 'End: $endDate',
                  ].join(' · '),
                ),
                trailing: isActive
                    ? const Chip(label: Text('Active'))
                    : null,
              ),
            );
          },
        );
      },
    );
  }
}

/// Infrastructure tab showing buildings, floors, rooms.
class _InfrastructureTab extends StatelessWidget {
  const _InfrastructureTab({required this.future});
  final Future<List<Map<String, dynamic>>>? future;

  @override
  Widget build(BuildContext context) {
    if (future == null) {
      return const _OfflinePlaceholder(
        message: 'Infrastructure data requires an internet connection.',
      );
    }
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: future,
      builder: (BuildContext context,
          AsyncSnapshot<List<Map<String, dynamic>>> snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return _OfflinePlaceholder(
            message: 'Failed to load infrastructure: ${snapshot.error}',
          );
        }
        final List<Map<String, dynamic>> items =
            snapshot.data ?? const <Map<String, dynamic>>[];
        if (items.isEmpty) {
          return const _OfflinePlaceholder(
            message: 'No infrastructure records found.',
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: items.length,
          separatorBuilder: (_, _) => const SizedBox(height: 8),
          itemBuilder: (BuildContext context, int index) {
            final Map<String, dynamic> item = items[index];
            final String name =
                (item['name'] as String?) ?? 'Item ${index + 1}';
            final String? type = item['type'] as String?;
            final String? condition = item['condition'] as String?;
            final num? capacity = item['capacity'] as num?;
            return Card(
              child: ListTile(
                leading: Icon(_iconForInfraType(type)),
                title: Text(name),
                subtitle: Text(
                  <String>[
                    ?type,
                    if (condition != null) 'Condition: $condition',
                    if (capacity != null) 'Capacity: $capacity',
                  ].join(' · '),
                ),
              ),
            );
          },
        );
      },
    );
  }

  IconData _iconForInfraType(String? type) {
    switch (type?.toLowerCase()) {
      case 'building':
        return Icons.apartment;
      case 'floor':
        return Icons.layers;
      case 'room':
        return Icons.meeting_room;
      case 'land':
        return Icons.landscape;
      default:
        return Icons.domain;
    }
  }
}

/// Reusable section card with labelled rows.
class _InfoSection extends StatelessWidget {
  const _InfoSection({required this.title, required this.rows});
  final String title;
  final List<_InfoRow> rows;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(title, style: theme.textTheme.titleSmall),
            const SizedBox(height: 8),
            ...rows.map((_InfoRow row) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      SizedBox(
                        width: 110,
                        child: Text(
                          row.label,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                      Expanded(
                        child: Text(
                          row.value == null || row.value!.isEmpty
                              ? '—'
                              : row.value!,
                          style: theme.textTheme.bodyMedium,
                        ),
                      ),
                    ],
                  ),
                )),
          ],
        ),
      ),
    );
  }
}

class _InfoRow {
  const _InfoRow({required this.label, required this.value});
  final String label;
  final String? value;
}

/// Placeholder shown when data is unavailable (offline or empty).
class _OfflinePlaceholder extends StatelessWidget {
  const _OfflinePlaceholder({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Icon(Icons.cloud_off, size: 48),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }
}
