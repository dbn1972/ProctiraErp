# Alertmanager routing and receivers — TEMPLATE (G-725).
#
# Rendered to alertmanager.yml by ./render-alertmanager.sh (envsubst) inside
# the `alertmanager-config` init container of docker-compose.observability.yml,
# or by the same script in CI/Kubernetes. Receiver credentials therefore come
# from the environment / secret manager and never live in git:
#
#   ALERT_EMAIL_TO                 default-email receiver (required)
#   ALERT_SMTP_FROM / ALERT_SMTP_SMARTHOST  SMTP relay (required for email)
#   PAGERDUTY_INTEGRATION_KEY      severity=critical → PagerDuty (optional*)
#   SLACK_WEBHOOK_URL              severity=warning  → #proctira-alerts (optional*)
#   SLACK_SECURITY_WEBHOOK_URL     team=security     → #proctira-security-alerts (optional*)
#
# * When a key is unset the renderer substitutes a documented "unconfigured"
#   sentinel and Alertmanager routes that severity to default-email instead, so
#   a missing PagerDuty key degrades to email rather than silently dropping
#   critical pages. Rendered output is validated with `amtool check-config`.
#
# Routing tree
#  - severity=critical          → pagerduty   (24x7 on-call)
#  - severity=warning           → slack       (#proctira-alerts)
#  - everything else            → email
global:
  resolve_timeout: 5m
  smtp_from: ${ALERT_SMTP_FROM}
  smtp_smarthost: ${ALERT_SMTP_SMARTHOST}
  smtp_require_tls: true

route:
  receiver: default-email
  group_by:
    - alertname
    - service
    - tenant_id
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers:
        - severity = "critical"
      receiver: ${ROUTE_CRITICAL_RECEIVER}
      group_wait: 0s
      repeat_interval: 1h
      continue: true

    - matchers:
        - severity = "warning"
      receiver: ${ROUTE_WARNING_RECEIVER}
      repeat_interval: 6h
      continue: true

    - matchers:
        - team = "security"
      receiver: ${ROUTE_SECURITY_RECEIVER}
      continue: true

inhibit_rules:
  # Suppress noisy availability alerts when a service is fully down.
  - source_matchers:
      - alertname = "ServiceDown"
    target_matchers:
      - alertname =~ "ServiceErrorRate.*|ServiceP95LatencyHigh|ServiceP99LatencyHigh"
    equal: ['service']

receivers:
  - name: default-email
    email_configs:
      - to: ${ALERT_EMAIL_TO}
        send_resolved: true

  - name: pagerduty-critical
    pagerduty_configs:
      - service_key: ${PAGERDUTY_INTEGRATION_KEY}
        send_resolved: true
        description: '{{ .CommonLabels.alertname }} on {{ .CommonLabels.service }}'
        details:
          severity: '{{ .CommonLabels.severity }}'
          team: '{{ .CommonLabels.team }}'
          runbook: '{{ .CommonAnnotations.runbook_url }}'

  - name: slack-warnings
    slack_configs:
      - api_url: ${SLACK_WEBHOOK_URL}
        channel: '#proctira-alerts'
        send_resolved: true
        title: '[{{ .Status | toUpper }}] {{ .CommonLabels.alertname }}'
        text: |
          *Service*: {{ .CommonLabels.service }}
          *Severity*: {{ .CommonLabels.severity }}
          *Description*: {{ .CommonAnnotations.description }}
          *Runbook*: {{ .CommonAnnotations.runbook_url }}

  - name: slack-security
    slack_configs:
      - api_url: ${SLACK_SECURITY_WEBHOOK_URL}
        channel: '#proctira-security-alerts'
        send_resolved: true
        title: '[SECURITY] {{ .CommonLabels.alertname }}'
        text: |
          *Service*: {{ .CommonLabels.service }}
          *Description*: {{ .CommonAnnotations.description }}
          *Runbook*: {{ .CommonAnnotations.runbook_url }}

templates: []
