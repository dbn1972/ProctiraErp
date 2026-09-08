{{- define "proctira-service.fullname" -}}
{{- printf "proctira-%s" .Values.service.name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "proctira-service.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ .Values.service.name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: proctira-platform
app.kubernetes.io/managed-by: {{ .Release.Service }}
proctira.io/environment: {{ .Values.environment | quote }}
{{- end -}}
