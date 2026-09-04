import 'package:flutter/material.dart';

import '../../../core/di/injector.dart';
import '../../../core/tenant/tenant_provider.dart';

/// Tenant / workspace selection screen.
///
/// The gateway does not expose a personal tenant directory for end users, so
/// this screen asks for a workspace ID, validates it, and persists the last
/// successful choice. No fake tenant lists are shown.
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

  static final RegExp _tenantIdPattern = RegExp(r'^[a-zA-Z0-9][a-zA-Z0-9._-]{1,62}$');

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
  }

  @override
  void dispose() {
    _tenantIdCtrl.dispose();
    _tenantNameCtrl.dispose();
    super.dispose();
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
                        ? 'Enter another workspace ID to switch. Your offline '
                            'data stays separate for each school.'
                        : 'Enter the workspace ID provided by your school or '
                            'ministry. The last successful ID is remembered '
                            'on this device.',
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
                  const SizedBox(height: 24),
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
                  const SizedBox(height: 24),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: <Widget>[
                          Container(
                            width: 36,
                            height: 36,
                            decoration: BoxDecoration(
                              color: const Color(0xFF0EA5E9)
                                  .withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: const Icon(
                              Icons.info_outline,
                              size: 18,
                              color: Color(0xFF0EA5E9),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              'A personal tenant directory is not available '
                              'on this device. Ask your administrator for the '
                              'correct workspace ID if you are unsure.',
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: colors.onSurfaceVariant,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
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
