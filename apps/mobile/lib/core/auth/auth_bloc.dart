import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:proctira_api_client/proctira_api_client.dart';

import '../notifications/push_device_lifecycle.dart';
import 'session_roles.dart';
import '../storage/database.dart';
import '../storage/secure_storage.dart';
import '../student/selected_student_store.dart';
import '../tenant/tenant_provider.dart';

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

abstract class AuthEvent extends Equatable {
  const AuthEvent();

  @override
  List<Object?> get props => const <Object?>[];
}

/// Restore session from secure storage on app start.
class AuthBootstrapRequested extends AuthEvent {
  const AuthBootstrapRequested();
}

/// User submitted credentials (or biometric) and we received tokens.
class AuthLoggedIn extends AuthEvent {
  const AuthLoggedIn({
    required this.userId,
    required this.accessToken,
    required this.refreshToken,
    this.email,
    this.displayName,
  });

  final String userId;
  final String accessToken;
  final String refreshToken;
  final String? email;
  final String? displayName;

  @override
  List<Object?> get props =>
      <Object?>[userId, accessToken, refreshToken, email, displayName];
}

/// User explicitly logged out.
class AuthLogoutRequested extends AuthEvent {
  const AuthLogoutRequested();
}

/// User picked a different workspace while signed in (PRC-M034).
///
/// Tokens are minted for one tenant, so switching performs a full logout
/// (server revoke, token wipe, selected student + cache purge, in-memory
/// tenant reset) and then activates [tenantId]; the router sends the user
/// to sign in against the new workspace.
class AuthWorkspaceSwitchRequested extends AuthEvent {
  const AuthWorkspaceSwitchRequested({required this.tenantId, this.displayName});

  final String tenantId;
  final String? displayName;

  @override
  List<Object?> get props => <Object?>[tenantId, displayName];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

enum AuthStatus { unknown, loading, authenticated, unauthenticated }

class AuthState extends Equatable {
  const AuthState({
    required this.status,
    this.userId,
    this.accessToken,
  });

  const AuthState.unknown() : this(status: AuthStatus.unknown);
  const AuthState.loading() : this(status: AuthStatus.loading);
  const AuthState.unauthenticated() : this(status: AuthStatus.unauthenticated);

  final AuthStatus status;
  final String? userId;
  final String? accessToken;

  bool get isAuthenticated => status == AuthStatus.authenticated;

  /// Roles from the access token's `roles` claim (PRC-M040).
  List<String> get roles => rolesFromAccessToken(accessToken);

  /// Staff routes/tiles are shown only with a non-portal role; unknown
  /// roles fail closed.
  bool get canUseStaffFeatures => hasStaffRole(roles);
  bool get isResolved =>
      status != AuthStatus.unknown && status != AuthStatus.loading;

  @override
  List<Object?> get props => <Object?>[status, userId, accessToken];
}

// ---------------------------------------------------------------------------
// Bloc
// ---------------------------------------------------------------------------

class AuthBloc extends Bloc<AuthEvent, AuthState> {
  AuthBloc({
    required SecureStorage secureStorage,
    AppDatabase? database,
    AuthApi? authApi,
    SelectedStudentStore? selectedStudent,
    PushDeviceLifecycle? push,
    TenantProvider? tenantProvider,
    Future<void> Function()? purgeLocalFiles,
  })  : _storage = secureStorage,
        _purgeLocalFiles = purgeLocalFiles,
        _tenantProvider = tenantProvider,
        _push = push,
        _database = database,
        _authApi = authApi,
        _selectedStudent = selectedStudent,
        super(const AuthState.unknown()) {
    on<AuthBootstrapRequested>(_onBootstrap);
    on<AuthLoggedIn>(_onLoggedIn);
    on<AuthLogoutRequested>(_onLogout);
    on<AuthWorkspaceSwitchRequested>(_onWorkspaceSwitch);
  }

  final SecureStorage _storage;
  final AppDatabase? _database;
  final AuthApi? _authApi;
  final SelectedStudentStore? _selectedStudent;
  final PushDeviceLifecycle? _push;
  final TenantProvider? _tenantProvider;

  /// Deletes on-device files holding user data (captured documents,
  /// PRC-M046).
  final Future<void> Function()? _purgeLocalFiles;

  Future<void> _onBootstrap(
    AuthBootstrapRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthState.loading());
    final String? access = await _storage.readAccessToken();
    final String? refresh = await _storage.readRefreshToken();
    if (access != null &&
        access.isNotEmpty &&
        refresh != null &&
        refresh.isNotEmpty) {
      final String? userId = await _storage.readUserId();
      emit(AuthState(
        status: AuthStatus.authenticated,
        userId: userId,
        accessToken: access,
      ));
      _registerPush();
    } else {
      emit(const AuthState.unauthenticated());
    }
  }

  Future<void> _onLoggedIn(AuthLoggedIn event, Emitter<AuthState> emit) async {
    await _storage.writeTokens(
      accessToken: event.accessToken,
      refreshToken: event.refreshToken,
    );
    await _storage.writeUserProfile(
      userId: event.userId,
      email: event.email,
      displayName: event.displayName,
    );
    emit(AuthState(
      status: AuthStatus.authenticated,
      userId: event.userId,
      accessToken: event.accessToken,
    ));
    _registerPush();
  }

  /// Fire-and-forget: push registration retries internally and must never
  /// block or fail the sign-in (PRC-M033).
  void _registerPush() {
    final PushDeviceLifecycle? push = _push;
    if (push != null) unawaited(push.onAuthenticated());
  }

  Future<void> _onLogout(
    AuthLogoutRequested event,
    Emitter<AuthState> emit,
  ) async {
    await _signOutAndPurge();
    emit(const AuthState.unauthenticated());
  }

  Future<void> _onWorkspaceSwitch(
    AuthWorkspaceSwitchRequested event,
    Emitter<AuthState> emit,
  ) async {
    await _signOutAndPurge();
    final TenantProvider? tenant = _tenantProvider;
    if (tenant != null) {
      await tenant.setTenant(
        tenantId: event.tenantId,
        displayName: event.displayName,
      );
    } else {
      await _storage.writeTenant(
        tenantId: event.tenantId,
        displayName: event.displayName,
      );
    }
    emit(const AuthState.unauthenticated());
  }

  /// Everything a sign-out must clear: push device, server session, tokens,
  /// tenant (storage AND in-memory), selected student, offline caches.
  Future<void> _signOutAndPurge() async {
    // Unregister the push device while the session is still valid, before
    // tokens are cleared and caches purged (PRC-M033).
    final PushDeviceLifecycle? push = _push;
    if (push != null) {
      try {
        await push.onLoggingOut();
      } catch (_) {
        // Local logout must succeed even if unregistration fails.
      }
    }
    final AuthApi? api = _authApi;
    if (api != null) {
      final String? refresh = await _storage.readRefreshToken();
      try {
        await api.logout(refreshToken: refresh);
      } catch (_) {
        // Local logout must succeed even when the network call fails.
      }
    }
    await _storage.clearTokens();
    final TenantProvider? tenant = _tenantProvider;
    if (tenant != null) {
      // Clears storage and the in-memory id used for X-Tenant-ID (PRC-M034).
      await tenant.clear();
    } else {
      await _storage.clearTenant();
    }
    await _selectedStudent?.clear();
    final AppDatabase? database = _database;
    if (database != null) {
      await database.purgeAllUserData();
    }
    final Future<void> Function()? purgeFiles = _purgeLocalFiles;
    if (purgeFiles != null) {
      try {
        await purgeFiles();
      } catch (_) {
        // Local logout must still complete.
      }
    }
  }
}
