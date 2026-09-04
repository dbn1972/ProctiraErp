import 'package:equatable/equatable.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/storage/secure_storage.dart';
import '../../auth/data/auth_repository.dart';

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
  ProfileBloc({
    required SecureStorage secureStorage,
    required AuthRepository authRepository,
  })  : _storage = secureStorage,
        _authRepository = authRepository,
        super(const ProfileState()) {
    on<ProfileLoaded>(_onLoaded);
    on<ProfileLocaleChanged>(_onLocaleChanged);
    on<ProfileThemeModeChanged>(_onThemeModeChanged);
    on<ProfileUpdated>(_onUpdated);
  }

  final SecureStorage _storage;
  final AuthRepository _authRepository;

  Future<void> _onLoaded(
    ProfileLoaded event,
    Emitter<ProfileState> emit,
  ) async {
    emit(state.copyWith(status: ProfileStatus.loading));

    final String? cachedId = await _storage.readUserId();
    final String? cachedName = await _storage.readUserDisplayName();
    final String? cachedEmail = await _storage.readUserEmail();
    final String? cachedPhone = await _storage.readUserPhone();
    final String? cachedRole = await _storage.readUserRole();

    if (cachedId != null ||
        cachedName != null ||
        cachedEmail != null ||
        cachedRole != null) {
      emit(state.copyWith(
        status: ProfileStatus.loaded,
        userId: cachedId ?? '',
        displayName: cachedName ?? cachedEmail ?? cachedId ?? 'User',
        email: cachedEmail ?? '',
        phone: cachedPhone ?? '',
        role: cachedRole ?? '',
      ));
    }

    try {
      final AuthUserProfile profile = await _authRepository.fetchCurrentUser();
      await _storage.writeUserProfile(
        userId: profile.userId,
        displayName: profile.displayName,
        email: profile.email,
        phone: profile.phone,
        role: profile.role,
      );
      emit(state.copyWith(
        status: ProfileStatus.loaded,
        userId: profile.userId,
        displayName: profile.displayName ??
            profile.email ??
            profile.userId,
        email: profile.email ?? '',
        phone: profile.phone ?? '',
        role: profile.role ?? '',
      ));
    } on AuthException catch (error) {
      if (state.status != ProfileStatus.loaded) {
        emit(state.copyWith(
          status: ProfileStatus.error,
          errorMessage: error.message,
          displayName: cachedName ?? 'User',
          userId: cachedId ?? '',
          email: cachedEmail ?? '',
          phone: cachedPhone ?? '',
          role: cachedRole ?? '',
        ));
      }
    } catch (error) {
      if (state.status != ProfileStatus.loaded) {
        emit(state.copyWith(
          status: ProfileStatus.error,
          errorMessage: error.toString(),
          displayName: cachedName ?? 'User',
          userId: cachedId ?? '',
          email: cachedEmail ?? '',
          phone: cachedPhone ?? '',
          role: cachedRole ?? '',
        ));
      }
    }
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
      final String displayName = event.displayName ?? state.displayName;
      final String email = event.email ?? state.email;
      final String phone = event.phone ?? state.phone;
      await _storage.writeUserProfile(
        displayName: displayName,
        email: email,
        phone: phone,
      );
      emit(state.copyWith(
        status: ProfileStatus.loaded,
        displayName: displayName,
        email: email,
        phone: phone,
      ));
    } catch (error) {
      emit(state.copyWith(
        status: ProfileStatus.error,
        errorMessage: error.toString(),
      ));
    }
  }
}
