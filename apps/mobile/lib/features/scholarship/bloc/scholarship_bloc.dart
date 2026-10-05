import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../data/scholarship_repository.dart';
import '../../../core/errors/user_error_message.dart';

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
    this.draftApplicationId,
    this.academicRecord,
  });

  final String programId;
  final String studentId;
  final Map<String, dynamic>? additionalData;
  final List<String>? documentIds;

  /// When set, finalize this draft instead of posting a new application.
  final String? draftApplicationId;

  /// Current school record from the form; synced into the draft.
  final ScholarshipAcademicRecord? academicRecord;

  @override
  List<Object?> get props => <Object?>[
    programId,
    studentId,
    additionalData,
    documentIds,
    draftApplicationId,
    academicRecord,
  ];
}

// --- State ---

enum ScholarshipStatus {
  initial,
  loading,
  loaded,
  submitting,
  submitted,
  error,
}

class ScholarshipState extends Equatable {
  const ScholarshipState({
    this.status = ScholarshipStatus.initial,
    this.programs = const <ScholarshipProgram>[],
    this.applications = const <ScholarshipApplication>[],
    this.studentId = '',
    this.errorMessage,
    this.fromCache = false,
  });

  final ScholarshipStatus status;
  final List<ScholarshipProgram> programs;
  final List<ScholarshipApplication> applications;
  final String studentId;
  final String? errorMessage;

  /// Data is saved offline copy, not a live answer (PRC-M043).
  final bool fromCache;

  ScholarshipState copyWith({
    ScholarshipStatus? status,
    List<ScholarshipProgram>? programs,
    List<ScholarshipApplication>? applications,
    String? studentId,
    String? errorMessage,
    bool? fromCache,
  }) {
    return ScholarshipState(
      status: status ?? this.status,
      programs: programs ?? this.programs,
      applications: applications ?? this.applications,
      studentId: studentId ?? this.studentId,
      errorMessage: errorMessage,
      fromCache: fromCache ?? this.fromCache,
    );
  }

  @override
  List<Object?> get props => <Object?>[
    status,
    programs,
    applications,
    studentId,
    errorMessage,
    fromCache,
  ];
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
      final List<ScholarshipProgram> programs = await _repository.getPrograms();
      emit(
        state.copyWith(
          status: ScholarshipStatus.loaded,
          programs: programs,
          fromCache: _repository.lastServedFromCache,
        ),
      );
    } catch (error) {
      emit(
        state.copyWith(
          status: ScholarshipStatus.error,
          errorMessage: userErrorMessage(error),
        ),
      );
    }
  }

  Future<void> _onApplicationsRequested(
    ScholarshipApplicationsRequested event,
    Emitter<ScholarshipState> emit,
  ) async {
    if (event.studentId.trim().isEmpty) {
      emit(
        state.copyWith(
          status: ScholarshipStatus.error,
          studentId: '',
          applications: const <ScholarshipApplication>[],
          errorMessage: 'Choose a student to view scholarship applications.',
        ),
      );
      return;
    }

    emit(
      state.copyWith(
        status: ScholarshipStatus.loading,
        studentId: event.studentId,
      ),
    );

    try {
      final List<ScholarshipApplication> applications = await _repository
          .getApplications(studentId: event.studentId);
      emit(
        state.copyWith(
          status: ScholarshipStatus.loaded,
          applications: applications,
          fromCache: _repository.lastServedFromCache,
        ),
      );
    } catch (error) {
      emit(
        state.copyWith(
          status: ScholarshipStatus.error,
          errorMessage: userErrorMessage(error),
        ),
      );
    }
  }

  Future<void> _onApplicationSubmitted(
    ScholarshipApplicationSubmitted event,
    Emitter<ScholarshipState> emit,
  ) async {
    if (event.studentId.trim().isEmpty) {
      emit(
        state.copyWith(
          status: ScholarshipStatus.error,
          errorMessage: 'Choose a student before submitting an application.',
        ),
      );
      return;
    }

    emit(state.copyWith(status: ScholarshipStatus.submitting));

    try {
      final ScholarshipProgram? program = await _repository.findProgram(
        event.programId,
      );
      if (program == null || !program.acceptsApplications) {
        emit(
          state.copyWith(
            status: ScholarshipStatus.error,
            errorMessage:
                'This scholarship is closed or the deadline has passed.',
          ),
        );
        return;
      }

      final String? draftId = event.draftApplicationId;
      if (draftId != null && draftId.isNotEmpty) {
        // Edits made after the first upload must reach the server before
        // finalize (PRC-M044).
        final ScholarshipAcademicRecord? record = event.academicRecord;
        if (record != null) {
          final Object? statement = event.additionalData?['personalStatement'];
          final Object? income = event.additionalData?['familyIncome'];
          await _repository.updateDraftApplication(
            applicationId: draftId,
            academicRecord: record,
            personalStatement: statement is String ? statement : null,
            familyIncome: income is num ? income.toDouble() : null,
          );
        }
        await _repository.finalizeApplication(draftId);
      } else {
        await _repository.submitApplication(
          programId: event.programId,
          studentId: event.studentId,
          additionalData: event.additionalData,
          documentIds: event.documentIds,
        );
      }
      emit(state.copyWith(status: ScholarshipStatus.submitted));
    } catch (error) {
      emit(
        state.copyWith(
          status: ScholarshipStatus.error,
          errorMessage: userErrorMessage(error),
        ),
      );
    }
  }
}
