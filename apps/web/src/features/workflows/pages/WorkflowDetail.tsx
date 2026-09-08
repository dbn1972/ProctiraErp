/**
 * WorkflowDetail — shows workflow instance state machine, history,
 * attachments, related entity preview, and action panel.
 *
 * Wired to the workflow-service API (Task 60A.1):
 *   - GET  /api/v1/workflows/instances/:instanceId
 *   - GET  /api/v1/workflows/instances/:instanceId/audit
 *   - GET  /api/v1/workflows/:definitionId (for state machine definition)
 *   - POST /api/v1/workflows/instances/:instanceId/transition
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import { browserGatewayFetch, BrowserGatewayError } from '@/lib/api/browser-gateway';

/* ------------------------------------------------------------------ Types */

interface WorkflowState {
  id: string;
  name: string;
  type: 'INITIAL' | 'INTERMEDIATE' | 'FINAL';
  assigneeType: 'role' | 'user' | 'area_role';
  assigneeId: string;
  institutionScoped?: boolean;
}

interface WorkflowTransition {
  id: string;
  fromStateId: string;
  toStateId: string;
  action: string;
  requiredApprovals?: number;
  conditions?: Array<{
    field: string;
    operator: string;
    value: unknown;
  }>;
}

interface EscalationRule {
  stateId: string;
  durationMinutes: number;
  escalateToStateId: string;
  notifyRoleId?: string;
}

interface WorkflowDefinition {
  id: string;
  tenantId: string;
  name: string;
  entityType: string;
  description: string | null;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
  escalationRules: EscalationRule[] | null;
  createdAt: string;
  updatedAt: string;
}

interface WorkflowInstance {
  id: string;
  workflowDefinitionId: string;
  entityType: string;
  entityId: string;
  currentStateId: string;
  status: string;
  metadata: Record<string, unknown> | null;
  approvals: Array<{
    stateId: string;
    actorId: string;
    action: string;
    timestamp: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

interface TransitionAuditEntry {
  id: string;
  instanceId: string;
  fromStateId: string;
  toStateId: string;
  action: string;
  actorId: string;
  comments: string | null;
  timestamp: string;
}

/* ------------------------------------------------------------------ Helpers */

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatEntityType(entityType: string): string {
  return entityType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getStateTypeColor(type: WorkflowState['type']): string {
  switch (type) {
    case 'INITIAL':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'INTERMEDIATE':
      return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case 'FINAL':
      return 'bg-green-100 text-green-800 border-green-300';
  }
}

/* ------------------------------------------------------------------ Component */

export default function WorkflowDetail() {
  const { instanceId } = useParams<{ instanceId: string }>();
  const navigate = useNavigate();

  const [instance, setInstance] = useState<WorkflowInstance | null>(null);
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [auditHistory, setAuditHistory] = useState<TransitionAuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Transition action state
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [transitionSuccess, setTransitionSuccess] = useState<string | null>(null);
  const [comments, setComments] = useState('');

  const fetchData = useCallback(async () => {
    if (!instanceId) return;
    setIsLoading(true);
    setError(null);

    try {
      // Fetch instance
      const instanceData = await browserGatewayFetch<WorkflowInstance>(
        `/workflows/instances/${instanceId}`,
      );
      setInstance(instanceData);

      // Fetch definition for state machine visualization
      const definitionData = await browserGatewayFetch<WorkflowDefinition>(
        `/workflows/${instanceData.workflowDefinitionId}`,
      );
      setDefinition(definitionData);

      // Fetch audit history
      const auditData = await browserGatewayFetch<{ data: TransitionAuditEntry[] }>(
        `/workflows/instances/${instanceId}/audit`,
      );
      setAuditHistory(auditData.data);
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setError(err.message);
      } else {
        setError('Failed to load workflow details');
      }
    } finally {
      setIsLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /**
   * Available transitions from the current state.
   */
  const availableTransitions =
    definition && instance
      ? definition.transitions.filter((t) => t.fromStateId === instance.currentStateId)
      : [];

  /**
   * Resolve a state name from its ID.
   */
  const getStateName = (stateId: string): string => {
    const state = definition?.states.find((s) => s.id === stateId);
    return state?.name ?? stateId;
  };

  /**
   * Perform a workflow transition.
   */
  const handleTransition = async (action: string) => {
    if (!instanceId) return;
    setIsTransitioning(true);
    setTransitionError(null);
    setTransitionSuccess(null);

    try {
      const result = await browserGatewayFetch<WorkflowInstance>(
        `/workflows/instances/${instanceId}/transition`,
        {
          method: 'POST',
          json: {
            action,
            actorId: 'current-user', // In production, resolved from auth context
            comments: comments || undefined,
          },
        },
      );
      setInstance(result);
      setTransitionSuccess(`Successfully performed: ${action}`);
      setComments('');
      // Refresh audit history
      const auditData = await browserGatewayFetch<{ data: TransitionAuditEntry[] }>(
        `/workflows/instances/${instanceId}/audit`,
      );
      setAuditHistory(auditData.data);
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setTransitionError(err.message);
      } else {
        setTransitionError('Failed to perform transition');
      }
    } finally {
      setIsTransitioning(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6" data-testid="workflow-detail-loading">
        <div className="h-8 w-64 animate-pulse rounded-md bg-muted" />
        <div className="h-48 animate-pulse rounded-md bg-muted" />
        <div className="h-32 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 space-y-4">
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
        <button
          onClick={() => navigate('/app/workflows/inbox')}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          ← Back to Inbox
        </button>
      </div>
    );
  }

  if (!instance || !definition) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Workflow instance not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate('/app/workflows/inbox')}
            className="text-sm text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1"
          >
            ← Back to Inbox
          </button>
          <h1 className="text-2xl font-semibold">{definition.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {formatEntityType(instance.entityType)} •{' '}
            {(instance.metadata?.entityLabel as string) || instance.entityId}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
            instance.status === 'ACTIVE'
              ? 'bg-blue-100 text-blue-800'
              : instance.status === 'COMPLETED'
                ? 'bg-green-100 text-green-800'
                : 'bg-gray-100 text-gray-800'
          }`}
        >
          {instance.status}
        </span>
      </div>

      {/* State Machine Visualization */}
      <section aria-labelledby="state-machine-heading">
        <h2 id="state-machine-heading" className="text-lg font-medium mb-3">
          Workflow States
        </h2>
        <div className="rounded-md border p-4 bg-background">
          <div className="flex flex-wrap gap-3 items-center">
            {definition.states.map((state, index) => {
              const isCurrent = state.id === instance.currentStateId;
              return (
                <div key={state.id} className="flex items-center gap-2">
                  <div
                    className={`rounded-lg border-2 px-4 py-2 text-sm font-medium transition-all ${getStateTypeColor(state.type)} ${
                      isCurrent ? 'ring-2 ring-primary ring-offset-2 scale-105' : 'opacity-70'
                    }`}
                    aria-current={isCurrent ? 'step' : undefined}
                  >
                    <div className="font-semibold">{state.name}</div>
                    <div className="text-xs opacity-75 mt-0.5">
                      {state.assigneeType}: {state.assigneeId}
                    </div>
                  </div>
                  {index < definition.states.length - 1 && (
                    <span className="text-muted-foreground text-lg" aria-hidden="true">
                      →
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Related Entity Preview */}
      <section aria-labelledby="entity-preview-heading">
        <h2 id="entity-preview-heading" className="text-lg font-medium mb-3">
          Related Entity
        </h2>
        <div className="rounded-md border p-4 bg-background">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="font-medium text-muted-foreground">Entity Type</dt>
              <dd className="mt-1">{formatEntityType(instance.entityType)}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Entity ID</dt>
              <dd className="mt-1 font-mono text-xs">{instance.entityId}</dd>
            </div>
            {instance.metadata &&
              Object.entries(instance.metadata)
                .filter(
                  ([key]) =>
                    key !== 'priority' && key !== 'slaDurationHours' && key !== 'entityLabel',
                )
                .map(([key, value]) => (
                  <div key={key}>
                    <dt className="font-medium text-muted-foreground">
                      {key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}
                    </dt>
                    <dd className="mt-1">{String(value)}</dd>
                  </div>
                ))}
          </dl>
        </div>
      </section>

      {/* Action Panel */}
      {instance.status === 'ACTIVE' && availableTransitions.length > 0 && (
        <section aria-labelledby="actions-heading">
          <h2 id="actions-heading" className="text-lg font-medium mb-3">
            Actions
          </h2>
          <div className="rounded-md border p-4 bg-background space-y-4">
            {/* Comments input */}
            <div>
              <label
                htmlFor="transition-comments"
                className="block text-sm font-medium text-muted-foreground mb-1"
              >
                Comments (optional)
              </label>
              <textarea
                id="transition-comments"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="Add comments for this action…"
                maxLength={2000}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {comments.length}/2000 characters
              </p>
            </div>

            {/* Transition buttons */}
            <div className="flex flex-wrap gap-2">
              {availableTransitions.map((transition) => {
                const isApprove = transition.action.toLowerCase().includes('approve');
                const isReject = transition.action.toLowerCase().includes('reject');
                const isEscalate = transition.action.toLowerCase().includes('escalate');

                let buttonClass = 'rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ';
                if (isApprove) {
                  buttonClass += 'bg-green-600 text-white hover:bg-green-700';
                } else if (isReject) {
                  buttonClass += 'bg-red-600 text-white hover:bg-red-700';
                } else if (isEscalate) {
                  buttonClass += 'bg-yellow-600 text-white hover:bg-yellow-700';
                } else {
                  buttonClass += 'bg-primary text-primary-foreground hover:bg-primary/90';
                }

                return (
                  <button
                    key={transition.id}
                    onClick={() => handleTransition(transition.action)}
                    disabled={isTransitioning}
                    className={buttonClass}
                    aria-label={`${transition.action} — transition to ${getStateName(transition.toStateId)}`}
                  >
                    {isTransitioning ? 'Processing…' : transition.action}
                  </button>
                );
              })}
            </div>

            {/* Transition feedback */}
            {transitionError && (
              <div
                className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
                role="alert"
              >
                {transitionError}
              </div>
            )}
            {transitionSuccess && (
              <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                {transitionSuccess}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Transition History */}
      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-lg font-medium mb-3">
          Transition History
        </h2>
        {auditHistory.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No transitions recorded yet.
          </div>
        ) : (
          <div className="rounded-md border">
            <div className="divide-y">
              {auditHistory.map((entry) => (
                <div key={entry.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                        {entry.action}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {getStateName(entry.fromStateId)} → {getStateName(entry.toStateId)}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(entry.timestamp)}
                    </span>
                  </div>
                  <div className="mt-2 text-sm">
                    <span className="text-muted-foreground">By: </span>
                    <span className="font-medium">{entry.actorId}</span>
                  </div>
                  {entry.comments && (
                    <p className="mt-2 text-sm text-muted-foreground italic">
                      &ldquo;{entry.comments}&rdquo;
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Escalation Rules */}
      {definition.escalationRules && definition.escalationRules.length > 0 && (
        <section aria-labelledby="escalation-heading">
          <h2 id="escalation-heading" className="text-lg font-medium mb-3">
            Escalation Rules
          </h2>
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">State</th>
                  <th className="px-4 py-3 text-left font-medium">Timeout</th>
                  <th className="px-4 py-3 text-left font-medium">Escalates To</th>
                  <th className="px-4 py-3 text-left font-medium">Notify</th>
                </tr>
              </thead>
              <tbody>
                {definition.escalationRules.map((rule, index) => (
                  <tr key={index} className="border-b">
                    <td className="px-4 py-3">{getStateName(rule.stateId)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {rule.durationMinutes >= 60
                        ? `${Math.floor(rule.durationMinutes / 60)}h ${rule.durationMinutes % 60}m`
                        : `${rule.durationMinutes}m`}
                    </td>
                    <td className="px-4 py-3">{getStateName(rule.escalateToStateId)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{rule.notifyRoleId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Instance Metadata */}
      <section aria-labelledby="metadata-heading">
        <h2 id="metadata-heading" className="text-lg font-medium mb-3">
          Instance Info
        </h2>
        <div className="rounded-md border p-4 bg-background">
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="font-medium text-muted-foreground">Created</dt>
              <dd className="mt-1">{formatDate(instance.createdAt)}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Last Updated</dt>
              <dd className="mt-1">{formatDate(instance.updatedAt)}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Instance ID</dt>
              <dd className="mt-1 font-mono text-xs">{instance.id}</dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  );
}
