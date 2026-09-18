{{- define "proctira-service.fullname" -}}
{{- printf "proctira-%s" .Values.service.name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "proctira-service.selectorLabels" -}}
app.kubernetes.io/name: {{ .Values.service.name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "proctira-service.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
{{ include "proctira-service.selectorLabels" . }}
app.kubernetes.io/part-of: proctira-platform
app.kubernetes.io/managed-by: {{ .Release.Service }}
proctira.io/environment: {{ .Values.environment | quote }}
{{- end -}}

{{- define "proctira-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "proctira-service.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
Name of the Kubernetes Secret that External Secrets Operator materialises.
The Deployment mounts it via envFrom, so the app never sees the provider.
*/}}
{{- define "proctira-service.externalSecretTarget" -}}
{{- default (printf "%s-env" (include "proctira-service.fullname" .)) .Values.externalSecret.targetName -}}
{{- end -}}

{{/* Resolve a service-profile probe path with legacy healthPath fallback. */}}
{{- define "proctira-service.livenessPath" -}}
{{- $profile := index .Values.serviceProfiles .Values.service.name | default dict -}}
{{- $legacy := default .Values.livenessPath (get $profile "healthPath") -}}
{{- default $legacy (get $profile "livenessPath") -}}
{{- end -}}

{{- define "proctira-service.readinessPath" -}}
{{- $profile := index .Values.serviceProfiles .Values.service.name | default dict -}}
{{- $legacy := default .Values.readinessPath (get $profile "healthPath") -}}
{{- default $legacy (get $profile "readinessPath") -}}
{{- end -}}

{{- define "proctira-service.startupPath" -}}
{{- $profile := index .Values.serviceProfiles .Values.service.name | default dict -}}
{{- $legacy := default .Values.startupPath (get $profile "healthPath") -}}
{{- default $legacy (get $profile "startupPath") -}}
{{- end -}}

{{/*
Whether Prometheus scrape annotations are emitted: metrics.enabled unless the
service profile opts out (Next.js apps expose no /metrics).
*/}}
{{- define "proctira-service.metricsEnabled" -}}
{{- $profile := index .Values.serviceProfiles .Values.service.name | default dict -}}
{{- if and .Values.metrics.enabled (ne (toString (get $profile "metrics")) "false") -}}true{{- end -}}
{{- end -}}

{{/*
W1-SEC-07: production metrics must use the chart's Secret-backed bearer and a
specific monitoring peer. The application also rejects METRICS_PUBLIC=1, but
render-time validation prevents known-unsafe manifests from being produced.
*/}}
{{- define "proctira-service.validateMetrics" -}}
{{- $metricsEnabled := eq (include "proctira-service.metricsEnabled" .) "true" -}}
{{- if and $metricsEnabled (ne .Values.metrics.path "/metrics") -}}
{{- fail "W1-SEC-07: metrics.path must be /metrics to match the application route" -}}
{{- end -}}
{{- if and (eq .Values.environment "production") (eq (toString (get .Values.env "METRICS_PUBLIC")) "1") -}}
{{- fail "W1-SEC-07: METRICS_PUBLIC=1 is forbidden in production" -}}
{{- end -}}
{{- if and (eq .Values.environment "production") (hasKey .Values.env "METRICS_BEARER_TOKEN") -}}
{{- fail "W1-SEC-07: production METRICS_BEARER_TOKEN must come from metrics.bearerTokenSecret, not plaintext values" -}}
{{- end -}}
{{- if and (eq .Values.environment "production") $metricsEnabled -}}
{{- if empty .Values.metrics.bearerTokenSecret.name -}}
{{- fail "W1-SEC-07: production metrics require metrics.bearerTokenSecret.name" -}}
{{- end -}}
{{- if empty .Values.metrics.bearerTokenSecret.key -}}
{{- fail "W1-SEC-07: production metrics require metrics.bearerTokenSecret.key" -}}
{{- end -}}
{{- if not .Values.networkPolicy.enabled -}}
{{- fail "W1-SEC-07: production metrics require NetworkPolicy" -}}
{{- end -}}
{{- if not .Values.metrics.networkPolicy.enabled -}}
{{- fail "W1-SEC-07: production metrics require the scrape-specific NetworkPolicy peer" -}}
{{- end -}}
{{- if empty .Values.metrics.networkPolicy.podSelector.matchLabels -}}
{{- fail "W1-SEC-07: production metrics require a non-empty Prometheus pod selector" -}}
{{- end -}}
{{- end -}}
{{- end -}}
