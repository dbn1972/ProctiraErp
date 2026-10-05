import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_bloc.dart';
import '../../../core/di/injector.dart';
import '../../../core/sync/unsynced_work.dart';
import '../../../core/tenant/tenant_provider.dart';

/// Stub tenant selection screen. The full tenant directory + onboarding flow
/// is built later; this scaffold lets a developer or QA configure a tenant id
/// so the rest of the app can be exercised.
class TenantSelectionScreen extends StatefulWidget {
  const TenantSelectionScreen({
    super.key,
    this.switchTimeout = const Duration(seconds: 45),
  });

  /// Upper bound on a signed-in workspace switch (sync attempt + purge).
  final Duration switchTimeout;

  @override
  State<TenantSelectionScreen> createState() => _TenantSelectionScreenState();
}

class _TenantSelectionScreenState extends State<TenantSelectionScreen> {
  final TextEditingController _tenantIdCtrl = TextEditingController();
  final TextEditingController _tenantNameCtrl = TextEditingController();
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  bool _switching = false;
  String? _switchError;

  @override
  void initState() {
    super.initState();
    final TenantProvider tenant = getIt<TenantProvider>();
    _tenantIdCtrl.text = tenant.tenantId ?? '';
    _tenantNameCtrl.text = tenant.displayName ?? '';
  }

  @override
  void dispose() {
    _tenantIdCtrl.dispose();
    _tenantNameCtrl.dispose();
    super.dispose();
  }

  Future<void> _onContinue() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final String tenantId = _tenantIdCtrl.text.trim();
    final String? displayName = _tenantNameCtrl.text.trim().isEmpty
        ? null
        : _tenantNameCtrl.text.trim();
    final TenantProvider tenant = getIt<TenantProvider>();
    final AuthBloc? auth = getIt.isRegistered<AuthBloc>()
        ? getIt<AuthBloc>()
        : null;
    if (auth != null &&
        auth.state.isAuthenticated &&
        tenant.tenantId != tenantId) {
      await _switchWorkspace(auth, tenantId, displayName);
      return;
    }
    await tenant.setTenant(tenantId: tenantId, displayName: displayName);
    if (!mounted) {
      return;
    }
    context.go('/');
  }

  /// Signed-in switch to another workspace: the previous tenant's tokens,
  /// selected student and caches must not carry over (PRC-M034). The bloc
  /// syncs, refuses if unsynced work would be purged, and otherwise signs
  /// out, purges and activates the new id.
  Future<void> _switchWorkspace(
    AuthBloc auth,
    String tenantId,
    String? displayName,
  ) async {
    setState(() {
      _switching = true;
      _switchError = null;
    });
    try {
      AuthState outcome = await _requestSwitch(
        auth,
        tenantId,
        displayName,
        discardUnsyncedWork: false,
      );
      final UnsyncedWork? blocked = outcome.blockedWorkspaceSwitch;
      if (outcome.isAuthenticated && blocked != null) {
        if (!mounted) return;
        final bool discard = await _confirmDiscard(blocked);
        if (!discard) {
          if (mounted) setState(() => _switching = false);
          return;
        }
        outcome = await _requestSwitch(
          auth,
          tenantId,
          displayName,
          discardUnsyncedWork: true,
        );
      }
      if (!mounted) return;
      if (outcome.isAuthenticated) {
        setState(() {
          _switching = false;
          _switchError = "Couldn't switch workspace. Please try again.";
        });
        return;
      }
      context.go('/login');
    } on TimeoutException {
      if (!mounted) return;
      setState(() {
        _switching = false;
        _switchError =
            'Switching workspace is taking too long. Check your connection '
            'and try again.';
      });
    }
  }

  /// Dispatch the switch and wait until the bloc either signs out or
  /// refuses. Bounded so a failing purge can never hang the screen.
  Future<AuthState> _requestSwitch(
    AuthBloc auth,
    String tenantId,
    String? displayName, {
    required bool discardUnsyncedWork,
  }) {
    final Future<AuthState> settled = auth.stream
        .firstWhere(
          (AuthState s) =>
              !s.isAuthenticated || s.blockedWorkspaceSwitch != null,
        )
        .timeout(widget.switchTimeout);
    auth.add(
      AuthWorkspaceSwitchRequested(
        tenantId: tenantId,
        displayName: displayName,
        discardUnsyncedWork: discardUnsyncedWork,
      ),
    );
    return settled;
  }

  Future<bool> _confirmDiscard(UnsyncedWork work) async {
    final bool? discard = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) {
        final ColorScheme colors = Theme.of(dialogContext).colorScheme;
        return AlertDialog(
          title: const Text('Unsynced work on this device'),
          content: Text(
            '${work.describe()}\n\n'
            'Switching workspace signs you out and permanently deletes it '
            'from this device. To keep it, stay here, connect to the '
            'internet and let it sync first.',
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Stay and keep it'),
            ),
            TextButton(
              key: const Key('discard-and-switch'),
              style: TextButton.styleFrom(foregroundColor: colors.error),
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Discard and switch'),
            ),
          ],
        );
      },
    );
    return discard ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme colors = theme.colorScheme;
    final bool isSwitchRoute =
        GoRouterState.of(context).uri.queryParameters['switch'] == '1';
    return Scaffold(
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
                  Text(
                    'Choose your workspace',
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                      fontSize: 24,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Configure your ProctiraERP workspace to continue.',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 24),
                  TextFormField(
                    controller: _tenantIdCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Workspace ID',
                      helperText: 'e.g. demo, ministry-of-education',
                      prefixIcon: Icon(Icons.apartment_outlined),
                    ),
                    validator: (String? value) {
                      if (value == null || value.trim().isEmpty) {
                        return 'Workspace ID is required';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _tenantNameCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Display name (optional)',
                      prefixIcon: Icon(Icons.badge_outlined),
                    ),
                  ),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: _switching ? null : _onContinue,
                    child: Text(
                      _switching
                          ? 'Switching workspace…'
                          : (isSwitchRoute ? 'Switch workspace' : 'Continue'),
                    ),
                  ),
                  if (_switchError != null) ...<Widget>[
                    const SizedBox(height: 12),
                    Semantics(
                      liveRegion: true,
                      child: Text(
                        _switchError!,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: colors.error,
                        ),
                      ),
                    ),
                  ],
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
                              color: const Color(
                                0xFF0EA5E9,
                              ).withValues(alpha: 0.12),
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
                              'You can switch workspaces anytime from '
                              'Profile. Switching signs you out and clears '
                              "this school's data from the device once it "
                              'has synced.',
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
