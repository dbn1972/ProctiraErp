import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../data/assessment_repository.dart';

// --- Events ---

abstract class AssessmentEvent extends Equatable {
  const AssessmentEvent();

  @override
  List<Object?> get props => <Object?>[];
}

class AssessmentResultsRequested extends AssessmentEvent {
  const AssessmentResultsRequested({
    required this.studentId,
    this.subjectFilter,
    this.periodFilter,
  });

  final String studentId;
  final String? subjectFilter;
  final String? periodFilter;

  @override
  List<Object?> get props => <Object?>[studentId, subjectFilter, periodFilter];
}

class AssessmentFilterChanged extends AssessmentEvent {
  const AssessmentFilterChanged({this.subject, this.period});

  final String? subject;
  final String? period;

  @override
  List<Object?> get props => <Object?>[subject, period];
}

// --- State ---

enum AssessmentStatus { initial, loading, loaded, error }

class AssessmentState extends Equatable {
  const AssessmentState({
    this.status = AssessmentStatus.initial,
    this.results = const <AssessmentResult>[],
    this.subjects = const <String>[],
    this.periods = const <String>[],
    this.selectedSubject,
    this.selectedPeriod,
    this.studentId = '',
    this.errorMessage,
  });

  final AssessmentStatus status;
  final List<AssessmentResult> results;
  final List<String> subjects;
  final List<String> periods;
  final String? selectedSubject;
  final String? selectedPeriod;
  final String studentId;
  final String? errorMessage;

  AssessmentState copyWith({
    AssessmentStatus? status,
    List<AssessmentResult>? results,
    List<String>? subjects,
    List<String>? periods,
    String? selectedSubject,
    String? selectedPeriod,
    String? studentId,
    String? errorMessage,
    bool clearSubject = false,
    bool clearPeriod = false,
  }) {
    return AssessmentState(
      status: status ?? this.status,
      results: results ?? this.results,
      subjects: subjects ?? this.subjects,
      periods: periods ?? this.periods,
      selectedSubject:
          clearSubject ? null : (selectedSubject ?? this.selectedSubject),
      selectedPeriod:
          clearPeriod ? null : (selectedPeriod ?? this.selectedPeriod),
      studentId: studentId ?? this.studentId,
      errorMessage: errorMessage,
    );
  }

  @override
  List<Object?> get props => <Object?>[
        status,
        results,
        subjects,
        periods,
        selectedSubject,
        selectedPeriod,
        studentId,
        errorMessage,
      ];
}

// --- Bloc ---

class AssessmentBloc extends Bloc<AssessmentEvent, AssessmentState> {
  AssessmentBloc({required AssessmentRepository repository})
      : _repository = repository,
        super(const AssessmentState()) {
    on<AssessmentResultsRequested>(_onResultsRequested);
    on<AssessmentFilterChanged>(_onFilterChanged);
  }

  final AssessmentRepository _repository;

  Future<void> _onResultsRequested(
    AssessmentResultsRequested event,
    Emitter<AssessmentState> emit,
  ) async {
    emit(state.copyWith(
      status: AssessmentStatus.loading,
      studentId: event.studentId,
    ));

    try {
      final List<AssessmentResult> results = await _repository.getResults(
        studentId: event.studentId,
        subjectFilter: event.subjectFilter,
        periodFilter: event.periodFilter,
      );
      final List<String> subjects =
          await _repository.getSubjects(studentId: event.studentId);
      final List<String> periods =
          await _repository.getPeriods(studentId: event.studentId);

      emit(state.copyWith(
        status: AssessmentStatus.loaded,
        results: results,
        subjects: subjects,
        periods: periods,
      ));
    } catch (error) {
      emit(state.copyWith(
        status: AssessmentStatus.error,
        errorMessage: error.toString(),
      ));
    }
  }

  Future<void> _onFilterChanged(
    AssessmentFilterChanged event,
    Emitter<AssessmentState> emit,
  ) async {
    emit(state.copyWith(
      selectedSubject: event.subject,
      selectedPeriod: event.period,
      clearSubject: event.subject == null,
      clearPeriod: event.period == null,
    ));

    if (state.studentId.isNotEmpty) {
      add(AssessmentResultsRequested(
        studentId: state.studentId,
        subjectFilter: event.subject ?? state.selectedSubject,
        periodFilter: event.period ?? state.selectedPeriod,
      ));
    }
  }
}
