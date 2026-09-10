#!/usr/bin/env sh
# Render alertmanager.yml from alertmanager.yml.tpl using environment variables
# (G-725). POSIX sh + envsubst only, so it runs in the alpine init container.
#
# Usage: render-alertmanager.sh [template] [output]
set -eu

TEMPLATE="${1:-$(dirname "$0")/alertmanager.yml.tpl}"
OUTPUT="${2:-$(dirname "$0")/alertmanager.yml}"

: "${ALERT_EMAIL_TO:?ALERT_EMAIL_TO is required (default receiver)}"
: "${ALERT_SMTP_FROM:=alertmanager@localhost}"
: "${ALERT_SMTP_SMARTHOST:=localhost:25}"

# Optional integrations: route to email when the credential is absent so no
# severity is ever routed to a receiver that cannot deliver.
if [ -n "${PAGERDUTY_INTEGRATION_KEY:-}" ]; then
  ROUTE_CRITICAL_RECEIVER=pagerduty-critical
else
  PAGERDUTY_INTEGRATION_KEY=unconfigured-see-render-alertmanager-sh
  ROUTE_CRITICAL_RECEIVER=default-email
  echo "warn: PAGERDUTY_INTEGRATION_KEY unset — severity=critical routes to email" >&2
fi
if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
  ROUTE_WARNING_RECEIVER=slack-warnings
else
  SLACK_WEBHOOK_URL=https://unconfigured.invalid/see-render-alertmanager-sh
  ROUTE_WARNING_RECEIVER=default-email
  echo "warn: SLACK_WEBHOOK_URL unset — severity=warning routes to email" >&2
fi
if [ -n "${SLACK_SECURITY_WEBHOOK_URL:-}" ]; then
  ROUTE_SECURITY_RECEIVER=slack-security
else
  SLACK_SECURITY_WEBHOOK_URL=https://unconfigured.invalid/see-render-alertmanager-sh
  ROUTE_SECURITY_RECEIVER=default-email
  echo "warn: SLACK_SECURITY_WEBHOOK_URL unset — team=security routes to email" >&2
fi

export ALERT_EMAIL_TO ALERT_SMTP_FROM ALERT_SMTP_SMARTHOST \
  PAGERDUTY_INTEGRATION_KEY SLACK_WEBHOOK_URL SLACK_SECURITY_WEBHOOK_URL \
  ROUTE_CRITICAL_RECEIVER ROUTE_WARNING_RECEIVER ROUTE_SECURITY_RECEIVER

# Only substitute our variables; Alertmanager's own {{ }} templates are untouched
# and any literal $ in the template stays as-is.
envsubst '${ALERT_EMAIL_TO} ${ALERT_SMTP_FROM} ${ALERT_SMTP_SMARTHOST} ${PAGERDUTY_INTEGRATION_KEY} ${SLACK_WEBHOOK_URL} ${SLACK_SECURITY_WEBHOOK_URL} ${ROUTE_CRITICAL_RECEIVER} ${ROUTE_WARNING_RECEIVER} ${ROUTE_SECURITY_RECEIVER}' \
  < "$TEMPLATE" > "$OUTPUT"

echo "rendered $OUTPUT (critical→$ROUTE_CRITICAL_RECEIVER, warning→$ROUTE_WARNING_RECEIVER, security→$ROUTE_SECURITY_RECEIVER)"
