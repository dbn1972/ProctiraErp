import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../data/health_repository.dart';

// --- Events ---

abstract class HealthEvent extends Equatable {
  const HealthEvent();

  @override
  List<Object?> get props => <Object?>[];
}

class HealthRecordsRequested extends HealthEvent {
  const HealthRecordsRequested({required this.studentId});

  final String studentId;

  @override
  List<Object?> get props => <Object?>[studentId];
}

// --- State ---

enum HealthStatus { initial, loading, loaded, error }

class HealthState extends Equatable {
  const HealthState({
    this.status = HealthStatus.initial,
    this.records = const HealthRecords(),
    this.studentId = '',
    this.errorMessage,
  });

  final HealthStatus status;
  final HealthRecords records;
  final String studentId;
  final String? errorMessage;

  HealthState copyWith({
    HealthStatus? status,
    HealthRecords? records,
    String? studentId,
    String? errorMessage,
  }) {
    return HealthState(
      status: status ?? this.status,
      records: records ?? this.records,
      studentId: studentId ?? this.studentId,
      errorMessage: errorMessage,
    );
  }

  @override
  List<Object?> get props => <Object?>[status, records, studentId, errorMessage];
}

// --- Bloc ---

class HealthBloc extends Bloc<HealthEvent, HealthState> {
  HealthBloc({required HealthRepository repository})
      : _repository = repository,
        super(const HealthState()) {
    on<HealthRecordsRequested>(_onRecordsRequested);
  }

  final HealthRepository _repository;

  Future<void> _onRecordsRequested(
    HealthRecordsRequested event,
    Emitter<HealthState> emit,
  ) async {
    emit(state.copyWith(
      status: HealthStatus.loading,
      studentId: event.studentId,
    ));

    try {
      final HealthRecords records =
          await _repository.getRecords(studentId: event.studentId);
      emit(state.copyWith(
        status: HealthStatus.loaded,
        records: records,
      ));
    } catch (error) {
      emit(state.copyWith(
        status: HealthStatus.error,
        errorMessage: error.toString(),
      ));
    }
  }
}
