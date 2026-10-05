/**
 * PipelineBuilder — form for creating/editing ETL pipeline definitions.
 *
 * Includes:
 *   - Source connector picker (PostgreSQL, REST API, CSV, Excel)
 *   - Destination connector picker
 *   - Field mapping grid with transformation rules
 *   - Schedule editor (cron expression with human-readable preview)
 *   - Retry policy configuration
 *
 * Wired to the ETL Service API (Task 60A.6 / Task 23):
 *   - GET /api/v1/pipelines/:id (load existing)
 *   - POST /api/v1/pipelines (create)
 *   - PUT /api/v1/pipelines/:id (update)
 *
 * Requirements: 14.1, 14.2, 14.4, 14.5, 14.6
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { browserGatewayFetch, BrowserGatewayError } from '@/lib/api/browser-gateway';
import {
  ConnectionStringError,
  describeSavedTarget,
  savedTargetFrom,
  toApiConnector,
  type SavedConnectorTarget,
} from '../connector-config';
import { etlPaths } from '../etl-api-paths';

/* ------------------------------------------------------------------ Types */

type SourceType = 'postgresql' | 'rest_api' | 'csv' | 'excel';
type DestinationType = 'postgresql' | 'rest_api' | 'csv';
type TransformationType = 'type_cast' | 'lookup' | 'concatenate' | 'format' | 'custom' | 'none';
type SchedulePreset = 'manual' | 'hourly' | 'daily' | 'weekly' | 'custom';

interface FieldMapping {
  id: string;
  sourceField: string;
  destinationField: string;
  transformation: TransformationType;
  transformConfig: string;
}

interface PipelineFormData {
  name: string;
  source: {
    type: SourceType;
    connectionString: string;
    query: string;
  };
  destination: {
    type: DestinationType;
    connectionString: string;
    table: string;
  };
  fieldMappings: FieldMapping[];
  schedule: string;
  schedulePreset: SchedulePreset;
  retryPolicy: {
    maxRetries: number;
    backoffMs: number;
  };
}

interface PipelineResponse {
  id: string;
  name: string;
  // PRC-H115: API connector schema (host/port/database/username/password,
  // url or filePath); secrets come back as the redaction placeholder.
  source: Record<string, unknown> & { type: string; query?: string };
  destination: Record<string, unknown> & { type: string; table?: string };
  fieldMappings: Array<{
    sourceField: string;
    destinationField: string;
    transformation: string;
    transformConfig: Record<string, unknown>;
  }>;
  schedule: string | null;
  retryPolicy: {
    maxRetries: number;
    backoffMs: number;
  };
}

/* ------------------------------------------------------------------ Helpers */

const SOURCE_TYPE_OPTIONS: { value: SourceType; label: string }[] = [
  { value: 'postgresql', label: 'PostgreSQL Database' },
  { value: 'rest_api', label: 'REST API' },
  { value: 'csv', label: 'CSV File' },
  { value: 'excel', label: 'Excel File' },
];

const DESTINATION_TYPE_OPTIONS: { value: DestinationType; label: string }[] = [
  { value: 'postgresql', label: 'PostgreSQL Database' },
  { value: 'rest_api', label: 'REST API' },
  { value: 'csv', label: 'CSV File' },
];

const TRANSFORMATION_OPTIONS: { value: TransformationType; label: string }[] = [
  { value: 'none', label: 'None (direct copy)' },
  { value: 'type_cast', label: 'Type Cast' },
  { value: 'lookup', label: 'Lookup Replacement' },
  { value: 'concatenate', label: 'Concatenate' },
  { value: 'format', label: 'Format' },
  { value: 'custom', label: 'Custom Expression' },
];

const SCHEDULE_PRESETS: { value: SchedulePreset; label: string; cron: string }[] = [
  { value: 'manual', label: 'Manual (no schedule)', cron: '' },
  { value: 'hourly', label: 'Every hour', cron: '0 * * * *' },
  { value: 'daily', label: 'Daily at midnight', cron: '0 0 * * *' },
  { value: 'weekly', label: 'Weekly on Monday', cron: '0 0 * * 1' },
  { value: 'custom', label: 'Custom cron expression', cron: '' },
];

/**
 * Converts a cron expression to a human-readable description.
 */
function cronToHumanReadable(cron: string): string {
  if (!cron) return 'No schedule (manual trigger only)';
  const parts = cron.split(' ');
  if (parts.length < 5) return `Custom: ${cron}`;

  const minute = parts[0] ?? '';
  const hour = parts[1] ?? '';
  const dayOfMonth = parts[2] ?? '';
  const month = parts[3] ?? '';
  const dayOfWeek = parts[4] ?? '';

  if (minute === '0' && hour === '*') return 'Runs every hour at minute 0';
  if (minute === '0' && hour === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*')
    return 'Runs daily at midnight (00:00)';
  if (minute === '0' && hour === '0' && dayOfWeek === '1')
    return 'Runs weekly on Monday at midnight';
  if (hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*')
    return `Runs daily at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  if (minute !== '*' && hour === '*') return `Runs every hour at minute ${minute}`;

  return `Cron: ${cron}`;
}

function generateMappingId(): string {
  return `mapping-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const INITIAL_FORM_DATA: PipelineFormData = {
  name: '',
  source: {
    type: 'postgresql',
    connectionString: '',
    query: '',
  },
  destination: {
    type: 'postgresql',
    connectionString: '',
    table: '',
  },
  fieldMappings: [
    {
      id: generateMappingId(),
      sourceField: '',
      destinationField: '',
      transformation: 'none',
      transformConfig: '',
    },
  ],
  schedule: '',
  schedulePreset: 'manual',
  retryPolicy: {
    maxRetries: 3,
    backoffMs: 1000,
  },
};

/* ------------------------------------------------------------------ Component */

export default function PipelineBuilder() {
  const { pipelineId } = useParams<{ pipelineId?: string }>();
  const navigate = useNavigate();
  const isEditing = Boolean(pipelineId);

  const [formData, setFormData] = useState<PipelineFormData>(INITIAL_FORM_DATA);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // PRC-H115: whether the loaded pipeline has a stored (redacted) credential.
  const [savedTargets, setSavedTargets] = useState<{
    source?: SavedConnectorTarget;
    destination?: SavedConnectorTarget;
  }>({});

  // Load existing pipeline for editing
  const loadPipeline = useCallback(async () => {
    if (!pipelineId) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await browserGatewayFetch<PipelineResponse>(etlPaths.pipeline(pipelineId));

      // Determine schedule preset from cron
      let schedulePreset: SchedulePreset = 'custom';
      if (!result.schedule) schedulePreset = 'manual';
      else if (result.schedule === '0 * * * *') schedulePreset = 'hourly';
      else if (result.schedule === '0 0 * * *') schedulePreset = 'daily';
      else if (result.schedule === '0 0 * * 1') schedulePreset = 'weekly';

      setSavedTargets({
        source: savedTargetFrom(result.source),
        destination: savedTargetFrom(result.destination),
      });
      setFormData({
        name: result.name,
        source: {
          type: result.source.type as SourceType,
          // PRC-H115: stored credentials are never loaded into the browser
          // form; leaving the field blank keeps the saved value.
          connectionString: '',
          query: result.source.query ?? '',
        },
        destination: {
          type: result.destination.type as DestinationType,
          connectionString: '',
          table: result.destination.table ?? '',
        },
        fieldMappings: result.fieldMappings.map((m) => ({
          id: generateMappingId(),
          sourceField: m.sourceField,
          destinationField: m.destinationField,
          transformation: (m.transformation || 'none') as TransformationType,
          transformConfig: m.transformConfig ? JSON.stringify(m.transformConfig) : '',
        })),
        schedule: result.schedule || '',
        schedulePreset,
        retryPolicy: result.retryPolicy,
      });
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setError(err.message);
      } else {
        setError('Failed to load pipeline');
      }
    } finally {
      setIsLoading(false);
    }
  }, [pipelineId]);

  useEffect(() => {
    loadPipeline();
  }, [loadPipeline]);

  // Form handlers
  const handleNameChange = (value: string) => {
    setFormData((prev) => ({ ...prev, name: value }));
  };

  const handleSourceChange = (field: keyof PipelineFormData['source'], value: string) => {
    setFormData((prev) => ({
      ...prev,
      source: { ...prev.source, [field]: value },
    }));
  };

  const handleDestinationChange = (field: keyof PipelineFormData['destination'], value: string) => {
    setFormData((prev) => ({
      ...prev,
      destination: { ...prev.destination, [field]: value },
    }));
  };

  const handleSchedulePresetChange = (preset: SchedulePreset) => {
    const presetConfig = SCHEDULE_PRESETS.find((p) => p.value === preset);
    setFormData((prev) => ({
      ...prev,
      schedulePreset: preset,
      schedule: presetConfig?.cron ?? prev.schedule,
    }));
  };

  const handleCustomCronChange = (value: string) => {
    setFormData((prev) => ({ ...prev, schedule: value }));
  };

  const handleRetryChange = (field: keyof PipelineFormData['retryPolicy'], value: number) => {
    setFormData((prev) => ({
      ...prev,
      retryPolicy: { ...prev.retryPolicy, [field]: value },
    }));
  };

  // Field mapping handlers
  const handleMappingChange = (id: string, field: keyof FieldMapping, value: string) => {
    setFormData((prev) => ({
      ...prev,
      fieldMappings: prev.fieldMappings.map((m) => (m.id === id ? { ...m, [field]: value } : m)),
    }));
  };

  const addFieldMapping = () => {
    setFormData((prev) => ({
      ...prev,
      fieldMappings: [
        ...prev.fieldMappings,
        {
          id: generateMappingId(),
          sourceField: '',
          destinationField: '',
          transformation: 'none',
          transformConfig: '',
        },
      ],
    }));
  };

  const removeFieldMapping = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      fieldMappings: prev.fieldMappings.filter((m) => m.id !== id),
    }));
  };

  // Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    // PRC-H115: map the connection input onto the API connector schema. When
    // editing, a blank input keeps the saved target and sends the redaction
    // placeholder so the API restores the stored password.
    let source: Record<string, unknown>;
    let destination: Record<string, unknown>;
    try {
      source = toApiConnector(formData.source, isEditing ? savedTargets.source : undefined);
      destination = toApiConnector(
        formData.destination,
        isEditing ? savedTargets.destination : undefined,
      );
    } catch (err) {
      setError(err instanceof ConnectionStringError ? err.message : 'Invalid connection string');
      setIsSaving(false);
      return;
    }
    const payload = {
      name: formData.name,
      source,
      destination,
      fieldMappings: formData.fieldMappings
        .filter((m) => m.sourceField && m.destinationField)
        .map((m) => ({
          sourceField: m.sourceField,
          destinationField: m.destinationField,
          transformation: m.transformation === 'none' ? undefined : m.transformation,
          transformConfig: m.transformConfig ? JSON.parse(m.transformConfig || '{}') : undefined,
        })),
      schedule: formData.schedule || null,
      retryPolicy: formData.retryPolicy,
    };

    try {
      if (isEditing && pipelineId) {
        await browserGatewayFetch(etlPaths.pipeline(pipelineId), {
          method: 'PUT',
          json: payload,
        });
      } else {
        await browserGatewayFetch(etlPaths.pipelines(), {
          method: 'POST',
          json: payload,
        });
      }
      navigate('/app/etl/pipelines');
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setError(err.message);
      } else {
        setError('Failed to save pipeline');
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4" data-testid="pipeline-builder-loading">
        <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-64 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{isEditing ? 'Edit Pipeline' : 'New Pipeline'}</h1>
        <button
          onClick={() => navigate('/app/etl/pipelines')}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          Cancel
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Pipeline Name */}
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Pipeline Name</h2>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g., Student Data Sync"
            required
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Pipeline name"
          />
        </section>

        {/* Source Configuration */}
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Source</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium mb-1">Source Type</label>
              <select
                value={formData.source.type}
                onChange={(e) => handleSourceChange('type', e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                aria-label="Source type"
              >
                {SOURCE_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="etl-source-connection" className="block text-sm font-medium mb-1">
                Connection String / URL
              </label>
              <input
                id="etl-source-connection"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                aria-describedby={isEditing ? 'etl-source-connection-hint' : undefined}
                value={formData.source.connectionString}
                onChange={(e) => handleSourceChange('connectionString', e.target.value)}
                placeholder={
                  formData.source.type === 'postgresql'
                    ? 'postgresql://user:pass@host:5432/db'
                    : formData.source.type === 'rest_api'
                      ? 'https://api.example.com/data'
                      : '/path/to/file'
                }
                required={!isEditing}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="Source connection string"
              />
              {isEditing ? (
                <p id="etl-source-connection-hint" className="mt-1 text-xs text-muted-foreground">
                  Saved credentials are hidden. Leave blank to keep them, or enter a new value.
                  {savedTargets.source &&
                  describeSavedTarget(formData.source.type, savedTargets.source)
                    ? ` Saved connection: ${describeSavedTarget(formData.source.type, savedTargets.source)}.`
                    : null}
                </p>
              ) : null}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              {formData.source.type === 'postgresql' ? 'SQL Query' : 'Data Path / Endpoint'}
            </label>
            <textarea
              value={formData.source.query}
              onChange={(e) => handleSourceChange('query', e.target.value)}
              placeholder={
                formData.source.type === 'postgresql'
                  ? 'SELECT * FROM students WHERE updated_at > :last_run'
                  : '/api/v1/records'
              }
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
              aria-label="Source query or path"
            />
          </div>
        </section>

        {/* Destination Configuration */}
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Destination</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium mb-1">Destination Type</label>
              <select
                value={formData.destination.type}
                onChange={(e) => handleDestinationChange('type', e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                aria-label="Destination type"
              >
                {DESTINATION_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="etl-destination-connection"
                className="block text-sm font-medium mb-1"
              >
                Connection String / URL
              </label>
              <input
                id="etl-destination-connection"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                aria-describedby={isEditing ? 'etl-destination-connection-hint' : undefined}
                value={formData.destination.connectionString}
                onChange={(e) => handleDestinationChange('connectionString', e.target.value)}
                placeholder="postgresql://user:pass@host:5432/db"
                required={!isEditing}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="Destination connection string"
              />
              {isEditing ? (
                <p
                  id="etl-destination-connection-hint"
                  className="mt-1 text-xs text-muted-foreground"
                >
                  Saved credentials are hidden. Leave blank to keep them, or enter a new value.
                  {savedTargets.destination &&
                  describeSavedTarget(formData.destination.type, savedTargets.destination)
                    ? ` Saved connection: ${describeSavedTarget(formData.destination.type, savedTargets.destination)}.`
                    : null}
                </p>
              ) : null}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              {formData.destination.type === 'postgresql'
                ? 'Target Table'
                : 'Target Path / Endpoint'}
            </label>
            <input
              type="text"
              value={formData.destination.table}
              onChange={(e) => handleDestinationChange('table', e.target.value)}
              placeholder={
                formData.destination.type === 'postgresql'
                  ? 'public.students_staging'
                  : '/api/v1/import'
              }
              required
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Destination table or path"
            />
          </div>
        </section>

        {/* Field Mappings */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Field Mappings</h2>
            <button
              type="button"
              onClick={addFieldMapping}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              + Add Mapping
            </button>
          </div>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm" data-testid="field-mapping-grid">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-start font-medium">Source Field</th>
                  <th className="px-3 py-2 text-start font-medium">Destination Field</th>
                  <th className="px-3 py-2 text-start font-medium">Transformation</th>
                  <th className="px-3 py-2 text-start font-medium">Config</th>
                  <th className="px-3 py-2 text-center font-medium w-16" />
                </tr>
              </thead>
              <tbody>
                {formData.fieldMappings.map((mapping) => (
                  <tr key={mapping.id} className="border-b">
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={mapping.sourceField}
                        onChange={(e) =>
                          handleMappingChange(mapping.id, 'sourceField', e.target.value)
                        }
                        placeholder="source_column"
                        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        aria-label="Source field name"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={mapping.destinationField}
                        onChange={(e) =>
                          handleMappingChange(mapping.id, 'destinationField', e.target.value)
                        }
                        placeholder="dest_column"
                        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        aria-label="Destination field name"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={mapping.transformation}
                        onChange={(e) =>
                          handleMappingChange(mapping.id, 'transformation', e.target.value)
                        }
                        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                        aria-label="Transformation type"
                      >
                        {TRANSFORMATION_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {mapping.transformation !== 'none' && (
                        <input
                          type="text"
                          value={mapping.transformConfig}
                          onChange={(e) =>
                            handleMappingChange(mapping.id, 'transformConfig', e.target.value)
                          }
                          placeholder='{"targetType": "integer"}'
                          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          aria-label="Transformation configuration"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => removeFieldMapping(mapping.id)}
                        disabled={formData.fieldMappings.length <= 1}
                        className="rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-30"
                        aria-label="Remove mapping"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Schedule */}
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Schedule</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium mb-1">Frequency</label>
              <select
                value={formData.schedulePreset}
                onChange={(e) => handleSchedulePresetChange(e.target.value as SchedulePreset)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                aria-label="Schedule frequency"
              >
                {SCHEDULE_PRESETS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            {formData.schedulePreset === 'custom' && (
              <div>
                <label className="block text-sm font-medium mb-1">Cron Expression</label>
                <input
                  type="text"
                  value={formData.schedule}
                  onChange={(e) => handleCustomCronChange(e.target.value)}
                  placeholder="0 */6 * * *"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label="Custom cron expression"
                />
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {cronToHumanReadable(formData.schedule)}
          </p>
        </section>

        {/* Retry Policy */}
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Retry Policy</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium mb-1">Max Retries</label>
              <input
                type="number"
                min={0}
                max={10}
                value={formData.retryPolicy.maxRetries}
                onChange={(e) => handleRetryChange('maxRetries', parseInt(e.target.value, 10) || 0)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="Maximum retry attempts"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Backoff (ms)</label>
              <input
                type="number"
                min={100}
                max={60000}
                step={100}
                value={formData.retryPolicy.backoffMs}
                onChange={(e) =>
                  handleRetryChange('backoffMs', parseInt(e.target.value, 10) || 1000)
                }
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="Backoff duration in milliseconds"
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            On failure, the pipeline will retry up to {formData.retryPolicy.maxRetries} time
            {formData.retryPolicy.maxRetries !== 1 ? 's' : ''} with {formData.retryPolicy.backoffMs}
            ms exponential backoff.
          </p>
        </section>

        {/* Submit */}
        <div className="flex gap-3 pt-4 border-t">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : isEditing ? 'Update Pipeline' : 'Create Pipeline'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/app/etl/pipelines')}
            className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
