import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/auth/auth_bloc.dart';

/// Biometric app-lock screen (PRC-M469).
///
/// Shown when a session was restored from storage but the user opted into
/// biometric app-lock. No PII is rendered here; the only action is to attempt
/// an unlock (which runs the platform biometric prompt) or to sign out.
class LockScreen extends StatelessWidget {
  const LockScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final AuthBloc bloc = context.read<AuthBloc>();
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Icon(Icons.lock_outline, size: 64),
              const SizedBox(height: 16),
              Text(
                'Locked',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 8),
              const Text(
                'Unlock with biometrics to continue.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: () =>
                    bloc.add(const AuthBiometricUnlockRequested()),
                icon: const Icon(Icons.fingerprint),
                label: const Text('Unlock'),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: () => bloc.add(const AuthLogoutRequested()),
                child: const Text('Sign out'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
