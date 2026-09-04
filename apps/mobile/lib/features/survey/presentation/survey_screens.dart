import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/injector.dart';
import '../../../core/tenant/tenant_provider.dart';
import '../data/survey_repository.dart';

class SurveysListScreen extends StatefulWidget {
  const SurveysListScreen({super.key});

  @override
  State<SurveysListScreen> createState() => _SurveysListScreenState();
}

class _SurveysListScreenState extends State<SurveysListScreen> {
  late Future<List<Survey>> _future;

  @override
  void initState() {
    super.initState();
    _future = getIt<SurveyRepository>().listSurveys();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Surveys')),
      body: FutureBuilder<List<Survey>>(
        future: _future,
        builder: (BuildContext context, AsyncSnapshot<List<Survey>> snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final List<Survey> items = snap.data ?? const <Survey>[];
          if (items.isEmpty) {
            return const Center(child: Text('No surveys available'));
          }
          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            itemCount: items.length,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (BuildContext context, int index) {
              final Survey s = items[index];
              return Card(
                child: ListTile(
                  title: Text(s.name),
                  subtitle: Text(
                    <String>[
                      s.status,
                      if (s.description != null && s.description!.isNotEmpty)
                        s.description!,
                    ].join(' · '),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.push('/surveys/${s.id}'),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class SurveyDetailScreen extends StatefulWidget {
  const SurveyDetailScreen({super.key, required this.surveyId});

  final String surveyId;

  @override
  State<SurveyDetailScreen> createState() => _SurveyDetailScreenState();
}

class _SurveyDetailScreenState extends State<SurveyDetailScreen> {
  late Future<Survey?> _future;
  final Map<String, TextEditingController> _controllers =
      <String, TextEditingController>{};
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _future = getIt<SurveyRepository>().getSurvey(widget.surveyId);
  }

  @override
  void dispose() {
    for (final TextEditingController c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  TextEditingController _controllerFor(SurveyQuestion q) {
    final String key = q.id ?? '${q.order}-${q.label}';
    return _controllers.putIfAbsent(key, TextEditingController.new);
  }

  Future<void> _submit(Survey survey) async {
    setState(() => _submitting = true);
    try {
      final String institutionId =
          getIt<TenantProvider>().tenantId ?? 'unknown';
      final List<Map<String, dynamic>> answers = survey.questions.map(
        (SurveyQuestion q) {
          final String key = q.id ?? '${q.order}-${q.label}';
          return <String, dynamic>{
            'questionId': q.id ?? key,
            'value': _controllers[key]?.text ?? '',
          };
        },
      ).toList(growable: false);

      await getIt<SurveyRepository>().submitResponse(
        surveyId: survey.id,
        institutionId: institutionId,
        answers: answers,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Survey submitted')),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Submit failed: $error')),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Survey')),
      body: FutureBuilder<Survey?>(
        future: _future,
        builder: (BuildContext context, AsyncSnapshot<Survey?> snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final Survey? survey = snap.data;
          if (survey == null) {
            return const Center(child: Text('Survey not found'));
          }
          final bool canRespond =
              survey.status == 'published' || survey.status == 'active';
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
            children: <Widget>[
              Text(survey.name, style: theme.textTheme.headlineSmall),
              const SizedBox(height: 6),
              Text(
                <String>[
                  survey.status,
                  if (survey.description != null) survey.description!,
                ].join(' · '),
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 20),
              if (survey.questions.isEmpty)
                const Card(
                  child: ListTile(title: Text('No questions on this survey')),
                )
              else
                ...survey.questions.map((SurveyQuestion q) {
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: TextField(
                      controller: _controllerFor(q),
                      enabled: canRespond && !_submitting,
                      decoration: InputDecoration(
                        labelText: q.required ? '${q.label} *' : q.label,
                        helperText: q.type,
                      ),
                      maxLines: q.type == 'text' ? 3 : 1,
                      keyboardType: q.type == 'number'
                          ? TextInputType.number
                          : TextInputType.text,
                    ),
                  );
                }),
              if (canRespond) ...<Widget>[
                const SizedBox(height: 8),
                FilledButton(
                  onPressed: _submitting ? null : () => _submit(survey),
                  child: _submitting
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Submit response'),
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}
