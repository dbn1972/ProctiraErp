import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:openemis_api_client/openemis_api_client.dart';

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
            return ListView.separated(
              itemCount: items.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (BuildContext context, int index) {
                final CachedInstitution institution = items[index];
                return ListTile(
                  leading: const Icon(Icons.school_outlined),
                  title: Text(institution.name),
                  subtitle: Text(<String>[
                    if (institution.code != null) 'Code: ${institution.code}',
                    if (institution.type != null) institution.type!,
                  ].join(' · ')),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.push('/institutions/${institution.id}'),
                );
              },
            );
          },
        ),
      ),
    );
  }
}
