import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/auth/auth_bloc.dart';
import '../../../core/auth/biometric_service.dart';
import '../../../core/di/injector.dart';
import '../../../core/storage/secure_storage.dart';
import '../../../core/tenant/tenant_provider.dart';
import '../data/auth_repository.dart';

/// Login form wired to [AuthRepository] (`POST /api/v1/auth/login`, with
/// Keycloak password-grant fallback) and optional biometric unlock via
/// `POST /api/v1/auth/refresh`.
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
  bool _obscurePassword = true;
  String? _errorMessage;

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
    setState(() {
      _submitting = true;
      _errorMessage = null;
    });

    try {
      final AuthSession session = await getIt<AuthRepository>().login(
        username: _username.text.trim(),
        password: _password.text,
      );
      if (!mounted) return;

      final BiometricService biometric = getIt<BiometricService>();
      if (await biometric.isAvailable()) {
        await biometric.setEnabled(true);
      }

      if (!mounted) return;
      context.read<AuthBloc>().add(AuthLoggedIn(
            userId: session.userId,
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            displayName: session.displayName,
            email: session.email,
            role: session.role,
          ));
    } on AuthException catch (error) {
      if (mounted) {
        setState(() => _errorMessage = error.message);
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _errorMessage = 'Sign-in failed. Please try again.',
        );
      }
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  Future<void> _onBiometric() async {
    setState(() {
      _submitting = true;
      _errorMessage = null;
    });

    try {
      final BiometricService biometric = getIt<BiometricService>();
      final bool ok = await biometric.authenticate(
        reason: 'Sign in to ProctiraERP with biometrics',
      );
      if (!ok || !mounted) {
        return;
      }

      final String? refreshToken =
          await getIt<SecureStorage>().readRefreshToken();
      if (refreshToken == null || refreshToken.isEmpty) {
        if (mounted) {
          setState(() {
            _errorMessage =
                'Sign in with your password once to enable biometric unlock.';
          });
        }
        return;
      }

      final AuthSession session =
          await getIt<AuthRepository>().refresh(refreshToken);
      if (!mounted) return;
      context.read<AuthBloc>().add(AuthLoggedIn(
            userId: session.userId,
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            displayName: session.displayName,
            email: session.email,
            role: session.role,
          ));
    } on AuthException catch (error) {
      if (mounted) {
        setState(() => _errorMessage = error.message);
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _errorMessage = 'Biometric unlock failed. Use your password.',
        );
      }
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final TenantProvider tenant = getIt<TenantProvider>();
    final ThemeData theme = Theme.of(context);

    final ColorScheme colors = theme.colorScheme;

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
                    // Brand mark.
                    Center(
                      child: Container(
                        width: 72,
                        height: 72,
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
                          borderRadius: BorderRadius.circular(24),
                          boxShadow: <BoxShadow>[
                            BoxShadow(
                              color: colors.primary.withValues(alpha: 0.35),
                              blurRadius: 28,
                              offset: const Offset(0, 12),
                            ),
                          ],
                        ),
                        child: const Center(
                          child: Text(
                            'P',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 32,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text.rich(
                      TextSpan(
                        children: <InlineSpan>[
                          const TextSpan(text: 'Proctira'),
                          TextSpan(
                            text: 'ERP',
                            style: TextStyle(color: colors.primary),
                          ),
                        ],
                      ),
                      textAlign: TextAlign.center,
                      style: theme.textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                        fontSize: 24,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      tenant.displayName ?? 'Sign in to your school workspace',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 34),
                    TextFormField(
                      controller: _username,
                      keyboardType: TextInputType.emailAddress,
                      autocorrect: false,
                      decoration: const InputDecoration(
                        labelText: 'Email or phone',
                        hintText: 'name@school.gov.in',
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
                      obscureText: _obscurePassword,
                      decoration: InputDecoration(
                        labelText: 'Password',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          icon: Icon(
                            _obscurePassword
                                ? Icons.visibility_outlined
                                : Icons.visibility_off_outlined,
                          ),
                          tooltip: _obscurePassword
                              ? 'Show password'
                              : 'Hide password',
                          onPressed: () => setState(
                            () => _obscurePassword = !_obscurePassword,
                          ),
                        ),
                      ),
                      validator: (String? value) {
                        if (value == null || value.isEmpty) {
                          return 'Required';
                        }
                        return null;
                      },
                    ),
                    if (_errorMessage != null) ...<Widget>[
                      const SizedBox(height: 12),
                      Text(
                        _errorMessage!,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: colors.error,
                        ),
                      ),
                    ],
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
                      const SizedBox(height: 24),
                      Row(
                        children: <Widget>[
                          Expanded(child: Divider(color: colors.outlineVariant)),
                          Padding(
                            padding:
                                const EdgeInsets.symmetric(horizontal: 12),
                            child: Text(
                              'OR',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: colors.onSurfaceVariant,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          Expanded(child: Divider(color: colors.outlineVariant)),
                        ],
                      ),
                      const SizedBox(height: 24),
                      OutlinedButton.icon(
                        onPressed: _submitting ? null : _onBiometric,
                        icon: const Icon(Icons.fingerprint),
                        label: const Text('Unlock with fingerprint'),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        "Biometric unlock uses your device's secure enclave.",
                        textAlign: TextAlign.center,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ],
                    const SizedBox(height: 28),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Row(
                          children: <Widget>[
                            Container(
                              width: 36,
                              height: 36,
                              decoration: BoxDecoration(
                                color: colors.secondary.withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Icon(
                                Icons.wifi_off_outlined,
                                size: 18,
                                color: colors.secondary,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                'Works offline after first sign-in — attendance '
                                'and marks sync when you\'re back online.',
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
      ),
    );
  }
}
