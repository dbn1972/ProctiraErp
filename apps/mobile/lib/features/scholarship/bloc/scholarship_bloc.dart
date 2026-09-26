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
    this.studentId = '',
    this.errorMessage,
  });

  final ScholarshipStatus status;
  final List<ScholarshipProgram> programs;
  final List<ScholarshipApplication> applications;
  final String studentId;
  final String? errorMessage;

  ScholarshipState copyWith({
    ScholarshipStatus? status,
    List<ScholarshipProgram>? programs,
    List<ScholarshipApplication>? applications,
    String? studentId,
    String? errorMessage,
  }) {
    return ScholarshipState(
      status: status ?? this.status,
      programs: programs ?? this.programs,
      applications: applications ?? this.applications,
      studentId: studentId ?? this.studentId,
      errorMessage: errorMessage,
    );
  }

  @override
  List<Object?> get props =>
      <Object?>[status, programs, applications, studentId, errorMessage];
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
    if (event.studentId.trim().isEmpty) {
      emit(state.copyWith(
        status: ScholarshipStatus.error,
        studentId: '',
        applications: const <ScholarshipApplication>[],
        errorMessage: 'Choose a student to view scholarship applications.',
      ));
      return;
    }

    emit(state.copyWith(
      status: ScholarshipStatus.loading,
      studentId: event.studentId,
    ));

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
    if (event.studentId.trim().isEmpty) {
      emit(state.copyWith(
        status: ScholarshipStatus.error,
        errorMessage: 'Choose a student before submitting an application.',
      ));
      return;
    }

    emit(state.copyWith(status: ScholarshipStatus.submitting));

    try {
      final ScholarshipProgram? program =
          await _repository.findProgram(event.programId);
      if (program == null || !program.acceptsApplications) {
        emit(state.copyWith(
          status: ScholarshipStatus.error,
          errorMessage:
              'This scholarship is closed or the deadline has passed.',
        ));
        return;
      }

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
