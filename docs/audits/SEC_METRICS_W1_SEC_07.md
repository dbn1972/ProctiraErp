# Security — Prometheus `/metrics` guard + cardinality (W1-SEC-07)

**Module / slice:** `@proctira/observability`, API gateway proxy trust, active
`proctira-service` Helm chart, Prometheus Kubernetes discovery
**Branch:** `security/W1-SEC-07-metrics-production`
**Date (UTC):** 2026-09-15
**Data class:** operational telemetry (process and HTTP topology; no tenant
roster labels)

## Outcome

W1-SEC-07 is implemented on this task branch and ready for review. Production
public metrics mode is rejected during plugin startup and denied again by the
authorization decision. Local/development open behavior remains deliberate.
The active production chart now uses a Secret-backed bearer, a selected
Prometheus NetworkPolicy peer, and the same `/metrics`/target-port contract as
the application and checked-in Prometheus job.

The finding becomes closed on the approved base only after the task PR is
reviewed and merged. No live-cluster deployment claim is made here.

## Controls and evidence

| Control                           | Repository evidence                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production public mode rejected   | `assertMetricsAccessConfiguration`; plugin readiness test; Helm render rejection for `.Values.env.METRICS_PUBLIC=1`                                                    |
| Defensive request denial          | `authorizeMetricsAccess` returns 403 if an unsafe production public state reaches it                                                                                   |
| Local/dev behavior preserved      | Non-production unset and explicit public mode remain open in unit tests                                                                                                |
| Timing-safe bearer                | `tokensMatch` continues to use Node `timingSafeEqual` after an equal-byte-length check                                                                                 |
| Remote default denial             | Production remote peer gets 403; loopback remains available when controls are unset                                                                                    |
| Bearer and allowlist              | Valid bearer, exact-IP allowlist, and combined bearer+allowlist paths are covered                                                                                      |
| Forwarded-header spoof resistance | Gateway defaults `trustProxy` to false; only `TRUSTED_PROXY_CIDRS` entries are trusted; trusted/untrusted peer tests cover `X-Forwarded-For`                           |
| Bounded labels                    | HTTP labels are service/method/registered route/status only; unknown raw paths collapse to `__unmatched__`; no `tenant_id` label is emitted                            |
| Production scrape binding         | Helm injects `METRICS_BEARER_TOKEN` from `proctira-metrics/token`, annotates `/metrics` on `service.targetPort`, and selects labeled Prometheus pods from `monitoring` |
| Scraper auth                      | `kubernetes-pods` uses Bearer `credentials_file: /etc/prometheus/secrets/proctira-metrics/token`; validator asserts the contract                                       |

## Rollout and rollback

Before rollout, the operator must replicate one generated scrape token through
the approved external-secret provider into each workload namespace and the
`monitoring` namespace, mount the monitoring Secret at the documented
credentials path, and verify the Prometheus pod label. Helm `--atomic --wait`
rolls back workloads if the required application Secret is absent. Rollback
uses the prior chart/image plus the prior Secret version; public mode is not an
allowed rollback mechanism.

## Residuals

- Repository tests and renders do not prove that live external-secret
  replication, Prometheus volume mounts, pod labels, NetworkPolicy enforcement,
  or target health are operating. Verify those after deployment.
- One token is accepted at a time, so coordinated rotation can create a brief
  scrape gap. Do not bridge rotation with public mode.
- The allowlist is exact-IP only. The canonical Kubernetes path uses bearer
  auth; operators choosing an allowlist must own stable source addressing.
- Aggregate repository CI and qualified security/code-owner approval remain PR
  gates; they are not claimed by this document.
