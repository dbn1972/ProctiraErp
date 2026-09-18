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
