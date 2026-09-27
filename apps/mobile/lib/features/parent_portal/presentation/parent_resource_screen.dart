import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../data/parent_portal_models.dart';
import '../data/parent_portal_repository.dart';

/// Shared loading, empty, and error chrome for a child-scoped parent list.
class ParentResourceScreen extends StatefulWidget {
  const ParentResourceScreen({
    super.key,
    required this.title,
    required this.studentId,
    required this.emptyMessage,
    required this.load,
    this.repository,
  });

  final String title;
  final String? studentId;
  final String emptyMessage;
  final ParentPortalRepository? repository;
  final Future<List<ParentPortalRow>> Function(
    ParentPortalRepository repository,
    String studentId,
  ) load;

  @override
  State<ParentResourceScreen> createState() => _ParentResourceScreenState();
}

class _ParentResourceScreenState extends State<ParentResourceScreen> {
  bool _loading = false;
  String? _error;
  List<ParentPortalRow> _rows = const <ParentPortalRow>[];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _load();
      }
    });
  }

  @override
  void didUpdateWidget(ParentResourceScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.studentId != widget.studentId) {
      _load();
    }
  }

  ParentPortalRepository _repository() {
    return widget.repository ?? context.read<ParentPortalRepository>();
  }

  Future<void> _load() async {
    final String? studentId = widget.studentId?.trim();
    if (studentId == null || studentId.isEmpty) {
      setState(() {
        _loading = false;
        _error = null;
        _rows = const <ParentPortalRow>[];
      });
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final List<ParentPortalRow> rows =
          await widget.load(_repository(), studentId);
      if (!mounted) {
        return;
      }
      setState(() {
        _loading = false;
        _rows = rows;
      });
    } on ParentPortalException catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loading = false;
        _error = error.message;
        _rows = const <ParentPortalRow>[];
      });
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loading = false;
        _error = 'Could not reach the parent portal. Try again.';
        _rows = const <ParentPortalRow>[];
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final String? studentId = widget.studentId?.trim();
    final bool missingChild = studentId == null || studentId.isEmpty;

    return Scaffold(
      appBar: AppBar(
        title: Semantics(header: true, child: Text(widget.title)),
      ),
      body: missingChild
          ? const _CenteredMessage(
              message: 'Select a child on the parent home screen.',
            )
          : _loading
              ? Semantics(
                  label: 'Loading ${widget.title}',
                  child: const Center(child: CircularProgressIndicator()),
                )
              : _error != null
                  ? _ErrorBody(message: _error!, onRetry: _load)
                  : _rows.isEmpty
                      ? _CenteredMessage(message: widget.emptyMessage)
                      : ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: _rows.length,
                          separatorBuilder: (_, _) => const SizedBox(height: 8),
                          itemBuilder: (BuildContext context, int index) {
                            final ParentPortalRow row = _rows[index];
                            return Semantics(
                              label: '${row.title}, ${row.subtitle}',
                              child: Card(
                                child: ListTile(
                                  minTileHeight: 48,
                                  title: Text(row.title),
                                  subtitle: Text(row.subtitle),
                                ),
                              ),
                            );
                          },
                        ),
    );
  }
}

class _CenteredMessage extends StatelessWidget {
  const _CenteredMessage({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          message,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodyLarge,
        ),
      ),
    );
  }
}

class _ErrorBody extends StatelessWidget {
  const _ErrorBody({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            Semantics(
              button: true,
              label: 'Retry',
              child: FilledButton(
                style: FilledButton.styleFrom(
                  minimumSize: const Size(44, 44),
                ),
                onPressed: onRetry,
                child: const Text('Retry'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
