import 'package:flutter/material.dart';

import '../../../core/di/injector.dart';
import '../../../core/tenant/tenant_provider.dart';

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
  void dispose() {
    _tenantIdCtrl.dispose();
    _tenantNameCtrl.dispose();
    super.dispose();
  }

  Future<void> _onContinue() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    await getIt<TenantProvider>().setTenant(
      tenantId: _tenantIdCtrl.text.trim(),
      displayName: _tenantNameCtrl.text.trim().isEmpty
          ? null
          : _tenantNameCtrl.text.trim(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Select tenant')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Text(
                  'Configure your OpenEMIS tenant to continue.',
                  style: theme.textTheme.bodyMedium,
                ),
                const SizedBox(height: 24),
                TextFormField(
                  controller: _tenantIdCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Tenant ID',
                    helperText: 'e.g. demo, ministry-of-education',
                  ),
                  validator: (String? value) {
                    if (value == null || value.trim().isEmpty) {
                      return 'Tenant ID is required';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _tenantNameCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Display name (optional)',
                  ),
                ),
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _onContinue,
                  child: const Text('Continue'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
