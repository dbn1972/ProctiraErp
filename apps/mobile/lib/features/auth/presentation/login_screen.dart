import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/auth/auth_bloc.dart';
import '../../../core/auth/biometric_service.dart';
import '../../../core/di/injector.dart';
import '../../../core/tenant/tenant_provider.dart';

/// Minimal login scaffold. Real authentication is implemented in subsequent
/// tasks; this screen wires the form into [AuthBloc] and exposes biometric
/// unlock when the device supports it.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final TextEditingController _username = TextEditingController();
  final TextEditingController _password = TextEditingController();
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();

  bool _biometricAvailable = false;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _detectBiometrics();
  }

  Future<void> _detectBiometrics() async {
    final BiometricService biometric = getIt<BiometricService>();
    final bool available = await biometric.isAvailable();
    if (mounted) {
      setState(() => _biometricAvailable = available);
    }
  }

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _onSubmit() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    setState(() => _submitting = true);

    // TODO(auth): replace with API call to /auth/login. For the scaffold we
    // emit a deterministic token so router redirects can be exercised.
    context.read<AuthBloc>().add(AuthLoggedIn(
          userId: _username.text.trim(),
          accessToken: 'pending-access-token',
          refreshToken: 'pending-refresh-token',
        ));

    if (mounted) {
      setState(() => _submitting = false);
    }
  }

  Future<void> _onBiometric() async {
    final BiometricService biometric = getIt<BiometricService>();
    final bool ok = await biometric.authenticate(
      reason: 'Sign in to OpenEMIS with biometrics',
    );
    if (!ok || !mounted) {
      return;
    }
    // TODO(auth): exchange biometric proof for tokens via the backend.
    context.read<AuthBloc>().add(const AuthLoggedIn(
          userId: 'biometric-user',
          accessToken: 'pending-access-token',
          refreshToken: 'pending-refresh-token',
        ));
  }

  @override
  Widget build(BuildContext context) {
    final TenantProvider tenant = getIt<TenantProvider>();
    final ThemeData theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Icon(Icons.school, size: 56, color: theme.colorScheme.primary),
                    const SizedBox(height: 16),
                    Text(
                      'OpenEMIS',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: theme.colorScheme.primary,
                      ),
                    ),
                    if (tenant.displayName != null) ...<Widget>[
                      const SizedBox(height: 4),
                      Text(
                        tenant.displayName!,
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodyMedium,
                      ),
                    ],
                    const SizedBox(height: 32),
                    TextFormField(
                      controller: _username,
                      keyboardType: TextInputType.emailAddress,
                      autocorrect: false,
                      decoration: const InputDecoration(
                        labelText: 'Username or email',
                        prefixIcon: Icon(Icons.person_outline),
                      ),
                      validator: (String? value) {
                        if (value == null || value.trim().isEmpty) {
                          return 'Required';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _password,
                      obscureText: true,
                      decoration: const InputDecoration(
                        labelText: 'Password',
                        prefixIcon: Icon(Icons.lock_outline),
                      ),
                      validator: (String? value) {
                        if (value == null || value.isEmpty) {
                          return 'Required';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 24),
                    FilledButton(
                      onPressed: _submitting ? null : _onSubmit,
                      child: _submitting
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Sign in'),
                    ),
                    if (_biometricAvailable) ...<Widget>[
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: _submitting ? null : _onBiometric,
                        icon: const Icon(Icons.fingerprint),
                        label: const Text('Use biometrics'),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
