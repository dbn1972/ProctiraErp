import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../data/scholarship_repository.dart';

// --- Events ---

abstract class ScholarshipEvent extends Equatable {
  const ScholarshipEvent();

  @override
  List<Object?> get props => <Object?>[];
}

class ScholarshipProgramsRequested extends ScholarshipEvent {
  const ScholarshipProgramsRequested();
}

class ScholarshipApplicationsRequested extends ScholarshipEvent {
  const ScholarshipApplicationsRequested({required this.studentId});

  final String studentId;

  @override
  List<Object?> get props => <Object?>[studentId];
}

class ScholarshipApplicationSubmitted extends ScholarshipEvent {
  const ScholarshipApplicationSubmitted({
    required this.programId,
    required this.studentId,
    this.additionalData,
    this.documentIds,
  });

  final String programId;
  final String studentId;
  final Map<String, dynamic>? additionalData;
  final List<String>? documentIds;

  @override
  List<Object?> get props =>
      <Object?>[programId, studentId, additionalData, documentIds];
}

// --- State ---

enum ScholarshipStatus { initial, loading, loaded, submitting, submitted, error }

class ScholarshipState extends Equatable {
  const ScholarshipState({
    this.status = ScholarshipStatus.initial,
    this.programs = const <ScholarshipProgram>[],
    this.applications = const <ScholarshipApplication>[],
    this.errorMessage,
  });

  final ScholarshipStatus status;
  final List<ScholarshipProgram> programs;
  final List<ScholarshipApplication> applications;
  final String? errorMessage;

  ScholarshipState copyWith({
    ScholarshipStatus? status,
    List<ScholarshipProgram>? programs,
    List<ScholarshipApplication>? applications,
    String? errorMessage,
  }) {
    return ScholarshipState(
      status: status ?? this.status,
      programs: programs ?? this.programs,
      applications: applications ?? this.applications,
      errorMessage: errorMessage,
    );
  }

  @override
  List<Object?> get props =>
      <Object?>[status, programs, applications, errorMessage];
}

// --- Bloc ---

class ScholarshipBloc extends Bloc<ScholarshipEvent, ScholarshipState> {
  ScholarshipBloc({required ScholarshipRepository repository})
      : _repository = repository,
        super(const ScholarshipState()) {
    on<ScholarshipProgramsRequested>(_onProgramsRequested);
    on<ScholarshipApplicationsRequested>(_onApplicationsRequested);
    on<ScholarshipApplicationSubmitted>(_onApplicationSubmitted);
  }

  final ScholarshipRepository _repository;

  Future<void> _onProgramsRequested(
    ScholarshipProgramsRequested event,
    Emitter<ScholarshipState> emit,
  ) async {
    emit(state.copyWith(status: ScholarshipStatus.loading));

    try {
      final List<ScholarshipProgram> programs =
          await _repository.getPrograms();
      emit(state.copyWith(
        status: ScholarshipStatus.loaded,
        programs: programs,
      ));
    } catch (error) {
      emit(state.copyWith(
        status: ScholarshipStatus.error,
        errorMessage: error.toString(),
      ));
    }
  }

  Future<void> _onApplicationsRequested(
    ScholarshipApplicationsRequested event,
    Emitter<ScholarshipState> emit,
  ) async {
    emit(state.copyWith(status: ScholarshipStatus.loading));

    try {
      final List<ScholarshipApplication> applications =
          await _repository.getApplications(studentId: event.studentId);
      emit(state.copyWith(
        status: ScholarshipStatus.loaded,
        applications: applications,
      ));
    } catch (error) {
      emit(state.copyWith(
        status: ScholarshipStatus.error,
        errorMessage: error.toString(),
      ));
    }
  }

  Future<void> _onApplicationSubmitted(
    ScholarshipApplicationSubmitted event,
    Emitter<ScholarshipState> emit,
  ) async {
    emit(state.copyWith(status: ScholarshipStatus.submitting));

    try {
      await _repository.submitApplication(
        programId: event.programId,
        studentId: event.studentId,
        additionalData: event.additionalData,
        documentIds: event.documentIds,
      );
      emit(state.copyWith(status: ScholarshipStatus.submitted));
    } catch (error) {
      emit(state.copyWith(
        status: ScholarshipStatus.error,
        errorMessage: error.toString(),
      ));
    }
  }
}
