import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_bloc.dart';
import '../../../core/l10n/app_localizations.dart';
import '../bloc/profile_bloc.dart';

/// User profile screen with personal info and settings navigation.
class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider<ProfileBloc>(
      create: (_) => ProfileBloc()..add(const ProfileLoaded()),
      child: const _ProfileView(),
    );
  }
}

class _ProfileView extends StatelessWidget {
  const _ProfileView();

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Semantics(header: true, child: Text(l10n.profile)),
      ),
      body: BlocBuilder<ProfileBloc, ProfileState>(
        builder: (BuildContext context, ProfileState state) {
          if (state.status == ProfileStatus.loading ||
              state.status == ProfileStatus.initial) {
            return const _ShimmerLoading();
          }

          return SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: <Widget>[
                // Avatar and name
                Semantics(
                  label: 'Profile picture for ${state.displayName}',
                  child: CircleAvatar(
                    radius: 48,
                    backgroundColor: theme.colorScheme.primaryContainer,
                    child: Text(
                      state.displayName.isNotEmpty
                          ? state.displayName[0].toUpperCase()
                          : '?',
                      style: theme.textTheme.headlineLarge?.copyWith(
                        color: theme.colorScheme.onPrimaryContainer,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  state.displayName,
                  style: theme.textTheme.headlineSmall,
                ),
                if (state.role.isNotEmpty)
                  Text(
                    state.role.toUpperCase(),
                    style: theme.textTheme.labelMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                const SizedBox(height: 24),

                // Info cards
                _InfoCard(
                  icon: Icons.email_outlined,
                  label: 'Email',
                  value: state.email.isNotEmpty ? state.email : 'Not set',
                ),
                _InfoCard(
                  icon: Icons.phone_outlined,
                  label: 'Phone',
                  value: state.phone.isNotEmpty ? state.phone : 'Not set',
                ),
                _InfoCard(
                  icon: Icons.badge_outlined,
                  label: 'User ID',
                  value: state.userId.isNotEmpty ? state.userId : '—',
                ),

                const SizedBox(height: 24),
                const Divider(),
                const SizedBox(height: 8),

                // Settings navigation
                _SettingsTile(
                  icon: Icons.notifications_outlined,
                  title: l10n.notificationPreferences,
                  onTap: () => context.push('/profile/notifications'),
                ),
                _SettingsTile(
                  icon: Icons.language_outlined,
                  title: l10n.language,
                  subtitle: _localeName(state.locale),
                  onTap: () => context.push('/profile/language'),
                ),
                _SettingsTile(
                  icon: Icons.palette_outlined,
                  title: l10n.theme,
                  subtitle: _themeModeName(state.themeMode, l10n),
                  onTap: () => context.push('/profile/theme'),
                ),

                const SizedBox(height: 24),

                // Logout
                Semantics(
                  button: true,
                  label: 'Logout',
                  child: OutlinedButton.icon(
                    onPressed: () {
                      context.read<AuthBloc>().add(const AuthLogoutRequested());
                    },
                    icon: const Icon(Icons.logout),
                    label: Text(l10n.logout),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      foregroundColor: theme.colorScheme.error,
                      side: BorderSide(color: theme.colorScheme.error),
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  String _localeName(Locale locale) {
    switch (locale.languageCode) {
      case 'hi':
        return 'हिन्दी';
      case 'ta':
        return 'தமிழ்';
      case 'te':
        return 'తెలుగు';
      case 'mr':
        return 'मराठी';
      case 'bn':
        return 'বাংলা';
      case 'gu':
        return 'ગુજરાતી';
      case 'kn':
        return 'ಕನ್ನಡ';
      case 'ar':
        return 'العربية';
      default:
        return 'English';
    }
  }

  String _themeModeName(ThemeMode mode, AppLocalizations l10n) {
    switch (mode) {
      case ThemeMode.light:
        return l10n.lightTheme;
      case ThemeMode.dark:
        return l10n.darkTheme;
      case ThemeMode.system:
        return l10n.systemTheme;
    }
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Semantics(
      label: '$label: $value',
      child: Card(
        margin: const EdgeInsets.only(bottom: 8),
        child: ListTile(
          leading: Icon(icon, color: theme.colorScheme.primary),
          title: Text(label, style: theme.textTheme.labelMedium),
          subtitle: Text(value, style: theme.textTheme.bodyLarge),
        ),
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    required this.icon,
    required this.title,
    this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Semantics(
      button: true,
      label: title,
      child: ListTile(
        leading: Icon(icon, color: theme.colorScheme.onSurfaceVariant),
        title: Text(title),
        subtitle: subtitle != null ? Text(subtitle!) : null,
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 8),
        minVerticalPadding: 12,
      ),
    );
  }
}

class _ShimmerLoading extends StatelessWidget {
  const _ShimmerLoading();

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Semantics(
      label: 'Loading profile',
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: <Widget>[
            Container(
              width: 96,
              height: 96,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: theme.colorScheme.surfaceContainerHighest,
              ),
            ),
            const SizedBox(height: 12),
            Container(
              height: 20,
              width: 150,
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(4),
              ),
            ),
            const SizedBox(height: 24),
            ...List<Widget>.generate(3, (int i) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Container(
                height: 60,
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            )),
          ],
        ),
      ),
    );
  }
}
