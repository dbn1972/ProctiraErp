import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../../core/di/injector.dart';
import '../../../core/tenant/tenant_provider.dart';

/// A workspace returned by `GET /api/v1/auth/tenants` (or `/tenants/mine`).
class TenantDirectoryEntry {
  const TenantDirectoryEntry({
    required this.id,
    required this.name,
    this.slug,
    this.status,
  });

  final String id;
  final String name;
  final String? slug;
  final String? status;

  factory TenantDirectoryEntry.fromJson(Map<String, dynamic> json) {
    return TenantDirectoryEntry(
      id: (json['id'] as String?) ?? '',
      name: (json['name'] as String?) ??
          (json['slug'] as String?) ??
          (json['id'] as String?) ??
          'Workspace',
      slug: json['slug'] as String?,
      status: json['status'] as String?,
    );
  }
}

/// Tenant / workspace selection screen.
///
/// Loads a selectable directory from `GET /api/v1/auth/tenants` when available,
/// and always keeps a manual workspace ID fallback.
class TenantSelectionScreen extends StatefulWidget {
  const TenantSelectionScreen({super.key});

  @override
  State<TenantSelectionScreen> createState() => _TenantSelectionScreenState();
}

class _TenantSelectionScreenState extends State<TenantSelectionScreen> {
  final TextEditingController _tenantIdCtrl = TextEditingController();
  final TextEditingController _tenantNameCtrl = TextEditingController();
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  bool _saving = false;
  String? _formError;
  Future<List<TenantDirectoryEntry>>? _directoryFuture;

  static final RegExp _tenantIdPattern =
      RegExp(r'^[a-zA-Z0-9][a-zA-Z0-9._-]{1,62}$');

  @override
  void initState() {
    super.initState();
    final TenantProvider tenant = getIt<TenantProvider>();
    if (tenant.tenantId != null) {
      _tenantIdCtrl.text = tenant.tenantId!;
    }
    if (tenant.displayName != null) {
      _tenantNameCtrl.text = tenant.displayName!;
    }
    _directoryFuture = _loadDirectory();
  }

  Future<List<TenantDirectoryEntry>> _loadDirectory() async {
    final Dio dio = getIt<Dio>();
    const List<String> paths = <String>[
      '/api/v1/auth/tenants',
      '/api/v1/tenants/mine',
    ];
    for (final String path in paths) {
      try {
        final Response<dynamic> response = await dio.get(path);
        final Object? body = response.data;
        final Object? data = body is Map ? body['data'] : body;
        if (data is List) {
          return data
              .whereType<Map>()
              .map(
                (Map e) =>
                    TenantDirectoryEntry.fromJson(Map<String, dynamic>.from(e)),
              )
              .where((TenantDirectoryEntry e) => e.id.isNotEmpty)
              .toList(growable: false);
        }
      } on DioException {
        continue;
      }
    }
    return const <TenantDirectoryEntry>[];
  }

  @override
  void dispose() {
    _tenantIdCtrl.dispose();
    _tenantNameCtrl.dispose();
    super.dispose();
  }

  Future<void> _selectDirectoryEntry(TenantDirectoryEntry entry) async {
    setState(() {
      _tenantIdCtrl.text = entry.id;
      _tenantNameCtrl.text = entry.name;
      _formError = null;
    });
    await _onContinue();
  }

  Future<void> _onContinue() async {
    setState(() => _formError = null);
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }

    final String tenantId = _tenantIdCtrl.text.trim();
    final String? displayName = _tenantNameCtrl.text.trim().isEmpty
        ? null
        : _tenantNameCtrl.text.trim();

    setState(() => _saving = true);
    try {
      await getIt<TenantProvider>().setTenant(
        tenantId: tenantId,
        displayName: displayName,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            displayName == null
                ? 'Workspace "$tenantId" saved'
                : 'Workspace "$displayName" saved',
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _formError =
            'Could not save workspace. Check the ID and try again.';
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_formError!)),
      );
    } finally {
      if (mounted) {
        setState(() => _saving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme colors = theme.colorScheme;
    final TenantProvider tenant = getIt<TenantProvider>();
    final bool hasExisting = tenant.hasTenant;

    return Scaffold(
      appBar: hasExisting
          ? AppBar(title: const Text('Switch workspace'))
          : null,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  if (!hasExisting) ...<Widget>[
                    Container(
                      width: 54,
                      height: 54,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: <Color>[
                            colors.primary,
                            Color.alphaBlend(
                              Colors.black.withValues(alpha: 0.28),
                              colors.primary,
                            ),
                          ],
                        ),
                        borderRadius: BorderRadius.circular(18),
                      ),
                      child: const Center(
                        child: Text(
                          'P',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 24,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                  Text(
                    hasExisting
                        ? 'Switch workspace'
                        : 'Choose your workspace',
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                      fontSize: 24,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    hasExisting
                        ? 'Pick a workspace from your directory or enter '
                            'another ID. Offline data stays separate per school.'
                        : 'Select a workspace from your account directory, or '
                            'enter the workspace ID from your school.',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                  if (hasExisting) ...<Widget>[
                    const SizedBox(height: 12),
                    Text(
                      'Current: ${tenant.displayName ?? tenant.tenantId}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: colors.primary,
                      ),
                    ),
                  ],
                  const SizedBox(height: 20),
                  FutureBuilder<List<TenantDirectoryEntry>>(
                    future: _directoryFuture,
                    builder: (
                      BuildContext context,
                      AsyncSnapshot<List<TenantDirectoryEntry>> snapshot,
                    ) {
                      if (snapshot.connectionState == ConnectionState.waiting) {
                        return const Padding(
                          padding: EdgeInsets.symmetric(vertical: 12),
                          child: Center(child: CircularProgressIndicator()),
                        );
                      }
                      final List<TenantDirectoryEntry> entries =
                          snapshot.data ?? const <TenantDirectoryEntry>[];
                      if (entries.isEmpty) {
                        return const SizedBox.shrink();
                      }
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: <Widget>[
                          Text(
                            'YOUR WORKSPACES',
                            style: theme.textTheme.labelSmall?.copyWith(
                              fontWeight: FontWeight.w700,
                              letterSpacing: 0.6,
                              color: colors.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Card(
                            margin: EdgeInsets.zero,
                            child: Column(
                              children: <Widget>[
                                for (int i = 0; i < entries.length; i++) ...<Widget>[
                                  if (i > 0) const Divider(height: 1),
                                  ListTile(
                                    leading: const Icon(Icons.apartment_outlined),
                                    title: Text(entries[i].name),
                                    subtitle: Text(
                                      entries[i].slug ?? entries[i].id,
                                      style: theme.textTheme.bodySmall?.copyWith(
                                        fontFamily: 'monospace',
                                      ),
                                    ),
                                    trailing: _saving
                                        ? const SizedBox(
                                            width: 18,
                                            height: 18,
                                            child: CircularProgressIndicator(
                                              strokeWidth: 2,
                                            ),
                                          )
                                        : const Icon(Icons.chevron_right),
                                    onTap: _saving
                                        ? null
                                        : () => _selectDirectoryEntry(entries[i]),
                                  ),
                                ],
                              ],
                            ),
                          ),
                          const SizedBox(height: 20),
                          Text(
                            'OR ENTER AN ID',
                            style: theme.textTheme.labelSmall?.copyWith(
                              fontWeight: FontWeight.w700,
                              letterSpacing: 0.6,
                              color: colors.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: 8),
                        ],
                      );
                    },
                  ),
                  TextFormField(
                    controller: _tenantIdCtrl,
                    textInputAction: TextInputAction.next,
                    autocorrect: false,
                    enableSuggestions: false,
                    decoration: const InputDecoration(
                      labelText: 'Workspace ID',
                      helperText:
                          '2–63 chars: letters, numbers, . _ - (e.g. demo-school)',
                      prefixIcon: Icon(Icons.apartment_outlined),
                    ),
                    validator: (String? value) {
                      final String trimmed = value?.trim() ?? '';
                      if (trimmed.isEmpty) {
                        return 'Workspace ID is required';
                      }
                      if (trimmed.length < 2) {
                        return 'Workspace ID must be at least 2 characters';
                      }
                      if (!_tenantIdPattern.hasMatch(trimmed)) {
                        return 'Use letters, numbers, dots, underscores, or hyphens';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _tenantNameCtrl,
                    textInputAction: TextInputAction.done,
                    onFieldSubmitted: (_) {
                      if (!_saving) {
                        _onContinue();
                      }
                    },
                    decoration: const InputDecoration(
                      labelText: 'Display name (optional)',
                      helperText: 'Shown in the app header and profile',
                      prefixIcon: Icon(Icons.badge_outlined),
                    ),
                  ),
                  if (_formError != null) ...<Widget>[
                    const SizedBox(height: 12),
                    Text(
                      _formError!,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: colors.error,
                      ),
                    ),
                  ],
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: _saving ? null : _onContinue,
                    child: _saving
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(hasExisting ? 'Save workspace' : 'Continue'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
