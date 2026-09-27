import 'package:equatable/equatable.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/auth/auth_bloc.dart';
import '../../../core/di/injector.dart';
import '../../../core/storage/secure_storage.dart';

// --- Events ---

abstract class ProfileEvent extends Equatable {
  const ProfileEvent();

  @override
  List<Object?> get props => <Object?>[];
}

class ProfileLoaded extends ProfileEvent {
  const ProfileLoaded();
}

class ProfileLocaleChanged extends ProfileEvent {
  const ProfileLocaleChanged(this.locale);

  final Locale locale;

  @override
  List<Object?> get props => <Object?>[locale];
}

class ProfileThemeModeChanged extends ProfileEvent {
  const ProfileThemeModeChanged(this.themeMode);

  final ThemeMode themeMode;

  @override
  List<Object?> get props => <Object?>[themeMode];
}

class ProfileUpdated extends ProfileEvent {
  const ProfileUpdated({
    this.displayName,
    this.email,
    this.phone,
  });

  final String? displayName;
  final String? email;
  final String? phone;

  @override
  List<Object?> get props => <Object?>[displayName, email, phone];
}

// --- State ---

enum ProfileStatus { initial, loading, loaded, saving, error }

class ProfileState extends Equatable {
  const ProfileState({
    this.status = ProfileStatus.initial,
    this.displayName = '',
    this.email = '',
    this.phone = '',
    this.userId = '',
    this.role = '',
    this.locale = const Locale('en'),
    this.themeMode = ThemeMode.system,
    this.errorMessage,
  });

  final ProfileStatus status;
  final String displayName;
  final String email;
  final String phone;
  final String userId;
  final String role;
  final Locale locale;
  final ThemeMode themeMode;
  final String? errorMessage;

  ProfileState copyWith({
    ProfileStatus? status,
    String? displayName,
    String? email,
    String? phone,
    String? userId,
    String? role,
    Locale? locale,
    ThemeMode? themeMode,
    String? errorMessage,
  }) {
    return ProfileState(
      status: status ?? this.status,
      displayName: displayName ?? this.displayName,
      email: email ?? this.email,
      phone: phone ?? this.phone,
      userId: userId ?? this.userId,
      role: role ?? this.role,
      locale: locale ?? this.locale,
      themeMode: themeMode ?? this.themeMode,
      errorMessage: errorMessage,
    );
  }

  @override
  List<Object?> get props => <Object?>[
        status,
        displayName,
        email,
        phone,
        userId,
        role,
        locale,
        themeMode,
        errorMessage,
      ];
}

// --- Bloc ---

class ProfileBloc extends Bloc<ProfileEvent, ProfileState> {
  ProfileBloc() : super(const ProfileState()) {
    on<ProfileLoaded>(_onLoaded);
    on<ProfileLocaleChanged>(_onLocaleChanged);
    on<ProfileThemeModeChanged>(_onThemeModeChanged);
    on<ProfileUpdated>(_onUpdated);
  }

  Future<void> _onLoaded(
    ProfileLoaded event,
    Emitter<ProfileState> emit,
  ) async {
    emit(state.copyWith(status: ProfileStatus.loading));

    final SecureStorage storage = getIt<SecureStorage>();
    final AuthState auth = getIt<AuthBloc>().state;
    final String? storedId = await storage.readUserId();
    final String? email = await storage.readUserEmail();
    final String? displayName = await storage.readUserDisplayName();
    final String userId = auth.userId ?? storedId ?? '';

    emit(state.copyWith(
      status: ProfileStatus.loaded,
      displayName: (displayName != null && displayName.isNotEmpty)
          ? displayName
          : (email != null && email.isNotEmpty ? email : 'Signed-in user'),
      email: email ?? '',
      phone: '',
      userId: userId,
      role: '',
    ));
  }

  void _onLocaleChanged(
    ProfileLocaleChanged event,
    Emitter<ProfileState> emit,
  ) {
    emit(state.copyWith(locale: event.locale));
  }

  void _onThemeModeChanged(
    ProfileThemeModeChanged event,
    Emitter<ProfileState> emit,
  ) {
    emit(state.copyWith(themeMode: event.themeMode));
  }

  Future<void> _onUpdated(
    ProfileUpdated event,
    Emitter<ProfileState> emit,
  ) async {
    emit(state.copyWith(status: ProfileStatus.saving));

    try {
      // Profile edit is device-local until a user-profile write API ships.
      final SecureStorage storage = getIt<SecureStorage>();
      final String userId = state.userId.isNotEmpty
          ? state.userId
          : (await storage.readUserId() ?? '');
      if (userId.isNotEmpty) {
        await storage.writeUserProfile(
          userId: userId,
          email: event.email ?? state.email,
          displayName: event.displayName ?? state.displayName,
        );
      }

      emit(state.copyWith(
        status: ProfileStatus.loaded,
        displayName: event.displayName ?? state.displayName,
        email: event.email ?? state.email,
        phone: event.phone ?? state.phone,
      ));
    } catch (error) {
      emit(state.copyWith(
        status: ProfileStatus.error,
        errorMessage: error.toString(),
      ));
    }
  }
}
