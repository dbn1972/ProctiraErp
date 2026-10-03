import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_bloc.dart';
import '../../../core/di/injector.dart';
import '../../../core/storage/database.dart';
import '../../../core/storage/secure_storage.dart';
import '../../../core/student/selected_student_store.dart';
import '../../../core/tenant/tenant_provider.dart';
import '../../../core/tenant/tenant_switch.dart';

/// Stub tenant selection screen. The full tenant directory + onboarding flow
/// is built later; this scaffold lets a developer or QA configure a tenant id
/// so the rest of the app can be exercised.
class TenantSelectionScreen extends StatefulWidget {
  const TenantSelectionScreen({super.key});

  @override
  State<TenantSelectionScreen> createState() => _TenantSelectionScreenState();
}

class _TenantSelectionScreenState extends State<TenantSelectionScreen> {
  final TextEditingController _tenantIdCtrl = TextEditingController();
  final TextEditingController _tenantNameCtrl = TextEditingController();
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();

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
    // PRC-M565: a different tenant wipes the prior tenant's session + caches.
    final bool purged =
        await TenantSwitcher(
          tenantProvider: getIt<TenantProvider>(),
          storage: getIt<SecureStorage>(),
          database: getIt<AppDatabase>(),
          selectedStudent: getIt<SelectedStudentStore>(),
        ).switchTo(
          tenantId: _tenantIdCtrl.text.trim(),
          displayName: _tenantNameCtrl.text.trim().isEmpty
              ? null
              : _tenantNameCtrl.text.trim(),
        );
    if (purged) {
      // Tokens are gone: re-resolve auth so the router sends the user to
      // sign in for the new workspace.
      getIt<AuthBloc>().add(const AuthBootstrapRequested());
    }
    if (!mounted) {
      return;
    }
    context.go('/');
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme colors = theme.colorScheme;
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
                    onPressed: _onContinue,
                    child: Text(
                      GoRouterState.of(context).uri.queryParameters['switch'] ==
                              '1'
                          ? 'Switch workspace'
                          : 'Continue',
                    ),
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
                              'Profile. Your offline data stays separate for '
                              'each school.',
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
