import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../core/di/injector.dart';
import '../../../core/errors/offline_data_banner.dart';
import '../../../core/errors/user_error_message.dart';
import '../../../core/sync/connectivity_monitor.dart';
import '../../../core/tenant/tenant_provider.dart';
import '../data/institution_repository.dart';

/// `/institutions` route — lists institutions cached locally. When the
/// device is online and a tenant is selected the whole institutions list is
/// paged from the API into the cache (PRC-M037); failures show an error with
/// retry rather than an empty state.
class InstitutionsScreen extends StatefulWidget {
  const InstitutionsScreen({super.key});

  @override
  State<InstitutionsScreen> createState() => _InstitutionsScreenState();
}

class _InstitutionsScreenState extends State<InstitutionsScreen> {
  late final InstitutionRepository _cache;
  late final ConnectivityMonitor _connectivity;
  late final TenantProvider _tenant;

  late Future<List<CachedInstitution>> _future;
  final TextEditingController _searchCtrl = TextEditingController();
  String _query = '';

  /// Safe message for the last failed refresh, or null.
  String? _error;

  /// True when the last refresh was skipped because the device is offline.
  bool _offline = false;

  @override
  void initState() {
    super.initState();
    _cache = getIt<InstitutionRepository>();
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
    String? error;
    bool offline = false;
    if (await _connectivity.isOnline()) {
      try {
        await _cache.refreshAll();
      } catch (e) {
        error = userErrorMessage(
          e,
          fallback: "Couldn't load institutions. Please try again.",
        );
      }
    } else {
      offline = true;
    }
    if (!mounted) return;
    setState(() {
      _error = error;
      _offline = offline;
      _future = _cache.list();
    });
  }

  Widget _errorBanner(ThemeData theme) {
    return Semantics(
      liveRegion: true,
      container: true,
      child: Material(
        color: theme.colorScheme.errorContainer,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 4, 4, 4),
          child: Row(
            children: <Widget>[
              Icon(
                Icons.error_outline,
                color: theme.colorScheme.onErrorContainer,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  _error!,
                  style: TextStyle(color: theme.colorScheme.onErrorContainer),
                ),
              ),
              TextButton(
                onPressed: () => _refresh(),
                style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      ),
    );
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
          builder:
              (
                BuildContext context,
                AsyncSnapshot<List<CachedInstitution>> snapshot,
              ) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }
                final List<CachedInstitution> items =
                    snapshot.data ?? const <CachedInstitution>[];
                if (items.isEmpty && _error != null) {
                  return ListView(
                    padding: const EdgeInsets.all(16),
                    children: <Widget>[
                      const SizedBox(height: 80),
                      _errorBanner(theme),
                    ],
                  );
                }
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
                    : items
                          .where((CachedInstitution i) {
                            return i.name.toLowerCase().contains(q) ||
                                (i.code?.toLowerCase().contains(q) ?? false);
                          })
                          .toList(growable: false);
                return ListView(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                  children: <Widget>[
                    if (_error != null) ...<Widget>[
                      _errorBanner(theme),
                      const SizedBox(height: 12),
                    ] else if (_offline) ...<Widget>[
                      const OfflineDataBanner(),
                      const SizedBox(height: 12),
                    ],
                    TextField(
                      controller: _searchCtrl,
                      onChanged: (String value) =>
                          setState(() => _query = value),
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
                      ...filtered.map(
                        (CachedInstitution institution) => Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: _InstitutionCard(
                            institution: institution,
                            onTap: () =>
                                context.push('/institutions/${institution.id}'),
                          ),
                        ),
                      ),
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
