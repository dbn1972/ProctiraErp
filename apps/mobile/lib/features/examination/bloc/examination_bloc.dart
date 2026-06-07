import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../data/examination_repository.dart';

// --- Events ---

abstract class ExaminationEvent extends Equatable {
  const ExaminationEvent();

  @override
  List<Object?> get props => <Object?>[];
}

class ExaminationListRequested extends ExaminationEvent {
  const ExaminationListRequested({required this.studentId});

  final String studentId;

  @override
  List<Object?> get props => <Object?>[studentId];
}

class ExaminationResultsRequested extends ExaminationEvent {
  const ExaminationResultsRequested({
    required this.studentId,
    this.examinationId,
  });

  final String studentId;
  final String? examinationId;

  @override
  List<Object?> get props => <Object?>[studentId, examinationId];
}

// --- State ---

enum ExaminationStatus { initial, loading, loaded, error }

class ExaminationState extends Equatable {
  const ExaminationState({
    this.status = ExaminationStatus.initial,
    this.examinations = const <Examination>[],
    this.results = const <ExaminationResult>[],
    this.studentId = '',
    this.errorMessage,
  });

  final ExaminationStatus status;
  final List<Examination> examinations;
  final List<ExaminationResult> results;
  final String studentId;
  final String? errorMessage;

  ExaminationState copyWith({
    ExaminationStatus? status,
    List<Examination>? examinations,
    List<ExaminationResult>? results,
    String? studentId,
    String? errorMessage,
  }) {
    return ExaminationState(
      status: status ?? this.status,
      examinations: examinations ?? this.examinations,
      results: results ?? this.results,
      studentId: studentId ?? this.studentId,
      errorMessage: errorMessage,
    );
  }

  @override
  List<Object?> get props =>
      <Object?>[status, examinations, results, studentId, errorMessage];
}

// --- Bloc ---

class ExaminationBloc extends Bloc<ExaminationEvent, ExaminationState> {
  ExaminationBloc({required ExaminationRepository repository})
      : _repository = repository,
        super(const ExaminationState()) {
    on<ExaminationListRequested>(_onListRequested);
    on<ExaminationResultsRequested>(_onResultsRequested);
  }

  final ExaminationRepository _repository;

  Future<void> _onListRequested(
    ExaminationListRequested event,
    Emitter<ExaminationState> emit,
  ) async {
    emit(state.copyWith(
      status: ExaminationStatus.loading,
      studentId: event.studentId,
    ));

    try {
      final List<Examination> exams = await _repository.getExaminations(
        studentId: event.studentId,
      );
      emit(state.copyWith(
        status: ExaminationStatus.loaded,
        examinations: exams,
      ));
    } catch (error) {
      emit(state.copyWith(
        status: ExaminationStatus.error,
        errorMessage: error.toString(),
      ));
    }
  }

  Future<void> _onResultsRequested(
    ExaminationResultsRequested event,
    Emitter<ExaminationState> emit,
  ) async {
    emit(state.copyWith(
      status: ExaminationStatus.loading,
      studentId: event.studentId,
    ));

    try {
      final List<ExaminationResult> results = await _repository.getResults(
        studentId: event.studentId,
        examinationId: event.examinationId,
      );
      emit(state.copyWith(
        status: ExaminationStatus.loaded,
        results: results,
      ));
    } catch (error) {
      emit(state.copyWith(
        status: ExaminationStatus.error,
        errorMessage: error.toString(),
      ));
    }
  }
}
