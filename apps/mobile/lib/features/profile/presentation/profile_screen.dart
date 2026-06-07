import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/auth/auth_bloc.dart';
import '../../../core/di/injector.dart';
import '../../../core/l10n/app_localizations.dart';
import '../../../core/tenant/tenant_provider.dart';
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

          final TenantProvider tenant = getIt<TenantProvider>();
          final String workspace = tenant.displayName ??
              tenant.tenantId ??
              'No workspace selected';
          final String roleLine = state.role.isNotEmpty
              ? '${state.role[0].toUpperCase()}${state.role.substring(1)}'
              : '';
          final String heroSub = <String>[
            if (roleLine.isNotEmpty) roleLine,
            if (tenant.displayName != null) tenant.displayName!,
          ].join(' · ');

          return SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                // Avatar and identity hero.
                Semantics(
                  label: 'Profile picture for ${state.displayName}',
                  child: CircleAvatar(
                    radius: 44,
                    backgroundColor: theme.colorScheme.primaryContainer,
                    child: Text(
                      state.displayName.isNotEmpty
                          ? state.displayName[0].toUpperCase()
                          : '?',
                      style: theme.textTheme.headlineLarge?.copyWith(
                        color: theme.colorScheme.onPrimaryContainer,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  state.displayName,
                  textAlign: TextAlign.center,
                  style: theme.textTheme.headlineSmall,
                ),
                if (heroSub.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 4),
                  Text(
                    heroSub,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
                const SizedBox(height: 24),

                // Account group.
                _SettingsGroup(
                  title: 'Account',
                  children: <Widget>[
                    _SettingsTile(
                      icon: Icons.person_outline,
                      color: const Color(0xFF4F46E5),
                      title: 'My account',
                      subtitle: state.email.isNotEmpty
                          ? state.email
                          : (state.userId.isNotEmpty
                              ? 'User ID ${state.userId}'
                              : null),
                    ),
                    if (state.phone.isNotEmpty)
                      _SettingsTile(
                        icon: Icons.phone_outlined,
                        color: const Color(0xFF0EA5E9),
                        title: 'Phone',
                        subtitle: state.phone,
                      ),
                    _SettingsTile(
                      icon: Icons.account_balance_outlined,
                      color: const Color(0xFF14B8A6),
                      title: 'Workspace',
                      subtitle: '$workspace · tap to switch',
                      onTap: () => context.go('/tenant'),
                    ),
                  ],
                ),
                const SizedBox(height: 16),

                // Preferences group.
                _SettingsGroup(
                  title: 'Preferences',
                  children: <Widget>[
                    _SettingsTile(
                      icon: Icons.notifications_outlined,
                      color: const Color(0xFF8B5CF6),
                      title: l10n.notificationPreferences,
                      onTap: () => context.push('/profile/notifications'),
                    ),
                    _SettingsTile(
                      icon: Icons.language_outlined,
                      color: const Color(0xFF0EA5E9),
                      title: l10n.language,
                      subtitle: _localeName(state.locale),
                      onTap: () => context.push('/profile/language'),
                    ),
                    _SettingsTile(
                      icon: Icons.palette_outlined,
                      color: const Color(0xFFF59E0B),
                      title: l10n.theme,
                      subtitle: _themeModeName(state.themeMode, l10n),
                      onTap: () => context.push('/profile/theme'),
                    ),
                  ],
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

/// A titled section wrapping a group of settings rows inside a single card.
class _SettingsGroup extends StatelessWidget {
  const _SettingsGroup({
    required this.title,
    required this.children,
  });

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final List<Widget> rows = <Widget>[];
    for (int i = 0; i < children.length; i++) {
      if (i > 0) {
        rows.add(const Divider(height: 1, indent: 64));
      }
      rows.add(children[i]);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 0, 0, 8),
          child: Text(title, style: theme.textTheme.titleMedium),
        ),
        Card(
          margin: EdgeInsets.zero,
          child: Column(children: rows),
        ),
      ],
    );
  }
}

class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    required this.icon,
    required this.color,
    required this.title,
    this.subtitle,
    this.onTap,
  });

  final IconData icon;
  final Color color;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Semantics(
      button: onTap != null,
      label: title,
      child: ListTile(
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(icon, size: 20, color: color),
        ),
        title: Text(
          title,
          style: theme.textTheme.titleSmall?.copyWith(
            fontWeight: FontWeight.w700,
          ),
        ),
        subtitle: subtitle != null
            ? Text(
                subtitle!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              )
            : null,
        trailing:
            onTap != null ? const Icon(Icons.chevron_right, size: 20) : null,
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
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
