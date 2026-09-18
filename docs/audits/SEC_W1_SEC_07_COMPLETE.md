# W1-SEC-07 closure evidence

| Field        | Value                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| Finding      | W1-SEC-07                                                                                                             |
| Title        | Production metrics public-mode bypass, proxy-source ambiguity, and incomplete authenticated scrape binding            |
| Branch       | `security/W1-SEC-07-metrics-production`                                                                               |
| Status       | **IMPLEMENTED — PR review/merge required for base-branch closure**                                                    |
| Closure mode | Code, negative tests, active Helm render gates, and documented production contract; no invented live-cluster evidence |

## Done-when evidence

- Production `METRICS_PUBLIC=1` rejects plugin startup and is denied in the
  lower-level authorization decision.
- Non-production local behavior remains open by design.
- Bearer matching remains timing-safe; token, allowlist, combined control,
  remote denial, and spoofed-forwarding cases are tested.
- Gateway `trustProxy` is false by default and accepts only explicit
  `TRUSTED_PROXY_CIDRS` entries.
- Default HTTP metrics have no `tenant_id`; unknown raw paths use one bounded
  `__unmatched__` label.
- The deploy workflow's `proctira-service` chart requires a Secret-backed
  bearer and selected monitoring peer in production, and Prometheus uses the
  matching credentials file.
- Helm and observability workflows are path-coupled to application metrics
  changes to prevent future code/config drift.

## Honest residuals

- Required CI and security/code-owner review must pass before merge.
- Live Secret replication, Prometheus mounts/labels, NetworkPolicy enforcement,
  scrape success, and post-deploy target health require cluster evidence.
- Coordinated single-token rotation may produce a short scrape gap.

See `docs/audits/SEC_METRICS_W1_SEC_07.md` and the task PR for command output,
review state, and final commit evidence.
