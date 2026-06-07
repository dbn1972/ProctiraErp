import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../storage/secure_storage.dart';

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
  });

  final String userId;
  final String accessToken;
  final String refreshToken;

  @override
  List<Object?> get props => <Object?>[userId, accessToken, refreshToken];
}

/// User explicitly logged out.
class AuthLogoutRequested extends AuthEvent {
  const AuthLogoutRequested();
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
  bool get isResolved => status != AuthStatus.unknown && status != AuthStatus.loading;

  @override
  List<Object?> get props => <Object?>[status, userId, accessToken];
}

// ---------------------------------------------------------------------------
// Bloc
// ---------------------------------------------------------------------------

class AuthBloc extends Bloc<AuthEvent, AuthState> {
  AuthBloc({required SecureStorage secureStorage})
      : _storage = secureStorage,
        super(const AuthState.unknown()) {
    on<AuthBootstrapRequested>(_onBootstrap);
    on<AuthLoggedIn>(_onLoggedIn);
    on<AuthLogoutRequested>(_onLogout);
  }

  final SecureStorage _storage;

  Future<void> _onBootstrap(
    AuthBootstrapRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthState.loading());
    final String? access = await _storage.readAccessToken();
    final String? refresh = await _storage.readRefreshToken();
    if (access != null && access.isNotEmpty && refresh != null && refresh.isNotEmpty) {
      emit(AuthState(
        status: AuthStatus.authenticated,
        accessToken: access,
      ));
    } else {
      emit(const AuthState.unauthenticated());
    }
  }

  Future<void> _onLoggedIn(AuthLoggedIn event, Emitter<AuthState> emit) async {
    await _storage.writeTokens(
      accessToken: event.accessToken,
      refreshToken: event.refreshToken,
    );
    emit(AuthState(
      status: AuthStatus.authenticated,
      userId: event.userId,
      accessToken: event.accessToken,
    ));
  }

  Future<void> _onLogout(AuthLogoutRequested event, Emitter<AuthState> emit) async {
    await _storage.clearTokens();
    emit(const AuthState.unauthenticated());
  }
}
