import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:proctira_api_client/proctira_api_client.dart';

import '../../../core/di/injector.dart';
import '../../../core/sync/connectivity_monitor.dart';
import '../../../core/tenant/tenant_provider.dart';
import '../data/institution_repository.dart';

/// `/institutions` route — lists institutions cached locally. When the
/// device is online and a tenant is selected we refresh the cache from the
/// API for the current institution.
class InstitutionsScreen extends StatefulWidget {
  const InstitutionsScreen({super.key});

  @override
  State<InstitutionsScreen> createState() => _InstitutionsScreenState();
}

class _InstitutionsScreenState extends State<InstitutionsScreen> {
  late final InstitutionRepository _cache;
  late final InstitutionApi _api;
  late final ConnectivityMonitor _connectivity;
  late final TenantProvider _tenant;

  late Future<List<CachedInstitution>> _future;
  final TextEditingController _searchCtrl = TextEditingController();
  String _query = '';

  @override
  void initState() {
    super.initState();
    _cache = getIt<InstitutionRepository>();
    _api = getIt<InstitutionApi>();
    _connectivity = getIt<ConnectivityMonitor>();
    _tenant = getIt<TenantProvider>();
    _future = _cache.list();
    // Trigger an initial refresh in the background when online.
    _refresh(silent: true);
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _refresh({bool silent = false}) async {
    final String? tenantId = _tenant.tenantId;
    if (tenantId == null) {
      if (!silent && mounted) {
        setState(() => _future = _cache.list());
      }
      return;
    }
    if (await _connectivity.isOnline()) {
      try {
        final Institution institution =
            await _api.fetchInstitution(tenantId);
        await _cache.upsert(institution);
      } catch (_) {
        // Skip silently when offline / endpoint unavailable.
      }
    }
    if (!mounted) return;
    setState(() => _future = _cache.list());
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Institutions')),
      body: RefreshIndicator(
        onRefresh: () => _refresh(),
        child: FutureBuilder<List<CachedInstitution>>(
          future: _future,
          builder: (BuildContext context,
              AsyncSnapshot<List<CachedInstitution>> snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            final List<CachedInstitution> items =
                snapshot.data ?? const <CachedInstitution>[];
            if (items.isEmpty) {
              return ListView(
                children: const <Widget>[
                  SizedBox(height: 120),
                  Center(
                    child: Column(
                      children: <Widget>[
                        Icon(Icons.school_outlined, size: 56),
                        SizedBox(height: 12),
                        Text('No institutions cached.'),
                        SizedBox(height: 4),
                        Text('Pull down to fetch the latest data.'),
                      ],
                    ),
                  ),
                ],
              );
            }
            final String q = _query.trim().toLowerCase();
            final List<CachedInstitution> filtered = q.isEmpty
                ? items
                : items.where((CachedInstitution i) {
                    return i.name.toLowerCase().contains(q) ||
                        (i.code?.toLowerCase().contains(q) ?? false);
                  }).toList(growable: false);
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              children: <Widget>[
                TextField(
                  controller: _searchCtrl,
                  onChanged: (String value) => setState(() => _query = value),
                  decoration: const InputDecoration(
                    hintText: 'Search by name or code',
                    prefixIcon: Icon(Icons.search),
                  ),
                ),
                const SizedBox(height: 16),
                if (filtered.isEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 80),
                    child: Center(
                      child: Text(
                        'No institutions match "$_query".',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  )
                else
                  ...filtered.map((CachedInstitution institution) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _InstitutionCard(
                          institution: institution,
                          onTap: () => context
                              .push('/institutions/${institution.id}'),
                        ),
                      )),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// v2.0 institution row: gradient icon tile + name + mono code subtitle.
class _InstitutionCard extends StatelessWidget {
  const _InstitutionCard({required this.institution, required this.onTap});

  final CachedInstitution institution;
  final VoidCallback onTap;

  String _initials(String name) {
    final List<String> parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((String p) => p.isNotEmpty)
        .toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts[1].substring(0, 1))
        .toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme cs = theme.colorScheme;
    final String subtitleText = <String>[
      if (institution.code != null) institution.code!,
      if (institution.type != null) institution.type!,
    ].join(' · ');
    final String? subtitle = subtitleText.isEmpty ? null : subtitleText;
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: <Widget>[
              Container(
                width: 46,
                height: 46,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: <Color>[
                      cs.primary,
                      Color.lerp(cs.primary, Colors.black, 0.25)!,
                    ],
                  ),
                ),
                child: Text(
                  _initials(institution.name),
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    fontSize: 14,
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      institution.name,
                      style: theme.textTheme.titleMedium,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (subtitle != null) ...<Widget>[
                      const SizedBox(height: 3),
                      Text(
                        subtitle,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: cs.onSurfaceVariant,
                          fontFeatures: const <FontFeature>[
                            FontFeature.tabularFigures(),
                          ],
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right, color: cs.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }
}
