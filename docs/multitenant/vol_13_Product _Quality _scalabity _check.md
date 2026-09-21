# Claude Code Scalability Audit Prompt

Copy and paste this prompt into Claude Code to audit and improve your product for **10 million users** and **1,000 transactions per second** scalability.

```text
You are a world-class principal architect and senior staff engineer.
Your task is to deeply review this codebase, infrastructure, and admin interface for scalability, reliability, and operational readiness.

Target scale:
- 10 million users
- 1,000 transactions per second
- High availability
- Low latency
- Safe degradation under load

Core architectural principle to validate:
1. All read-heavy flows should read from cache first.
2. If cache data is missing, stale, or invalid, the system may fall back to the database.
3. Database fallback must be controlled, monitored, rate-limited, and must repopulate the cache.
4. All write-heavy flows should go through a durable queue/event system first.
5. Queue consumers should process writes into the database asynchronously where business rules allow.
6. Direct database writes should be treated as exceptions and reported as scalability violations unless clearly justified.
7. The system must have observability for cache, queue, database, API latency, failures, retries, and saturation.
8. Admin users should be able to monitor and configure cache and queue behavior safely from an admin page.

Your job is to perform a full scalability audit and produce both a report and recommended code/infrastructure changes.

Please inspect:
- Backend API routes/controllers
- Services
- Repositories/DAO/database access layers
- Cache usage
- Queue/message broker usage
- Background workers/consumers
- Database schema and indexes
- Infrastructure/IaC files
- Admin UI
- Monitoring/logging/metrics
- Configuration management
- Retry/fallback logic
- Rate limiting and throttling
- Failure-handling behavior
- Tests

Key things to check:

A. Read scalability
- Identify every code path that reads directly from the database.
- Check whether each read path uses cache first.
- Check cache key design, TTL, invalidation, refresh strategy, and stampede protection.
- Check whether cache misses fall back to DB safely.
- Check whether DB fallback repopulates cache.
- Check whether repeated cache misses could overload the database.
- Check whether there is negative caching for missing records where appropriate.
- Check whether hot keys are handled.
- Check whether cache failures degrade gracefully.
- Check whether direct DB reads are necessary or are scalability violations.

B. Write scalability
- Identify every code path that writes directly to the database.
- Check whether writes are going through a durable queue.
- Check whether queue messages are persistent/durable.
- Check whether writes are idempotent.
- Check whether retries, dead-letter queues, poison message handling, and backoff exist.
- Check whether queue consumers are horizontally scalable.
- Check whether ordering requirements are handled.
- Check whether duplicate message delivery is safe.
- Check whether cache is invalidated or updated after writes.
- Check whether direct DB writes are justified or are scalability violations.

C. Cache monitoring
Check whether the system exposes and/or records:
- Cache hit rate
- Cache miss rate
- Cache latency
- Cache error rate
- Eviction count
- Key cardinality / memory usage
- Hot keys
- Stale data count
- Cache fallback-to-DB count
- Cache repopulation failures
- Cache availability
- Per-endpoint cache effectiveness

D. Queue monitoring
Check whether the system exposes and/or records:
- Queue depth
- Queue lag
- Oldest message age
- Consumer processing rate
- Consumer error rate
- Retry count
- Dead-letter queue count
- Message processing latency
- Duplicate message count
- Poison message count
- Queue availability
- Backpressure status
- Per-message-type throughput

E. Admin page requirements
Check whether the admin page allows authorized admins to:
- View cache health
- View cache hit/miss metrics
- View queue depth and lag
- View dead-letter queue messages
- Retry failed queue messages
- Pause/resume queue consumers if supported
- Configure cache TTL per domain/module
- Enable/disable cache usage per feature flag
- Configure queue retry limits
- Configure backoff settings
- Configure DLQ behavior
- View direct DB fallback counts
- View direct DB read/write violations
- View system health dashboard
- Export scalability audit data
- See clear warnings before dangerous configuration changes

F. Infrastructure readiness
Review the infrastructure for:
- Horizontal scaling support
- Load balancer configuration
- Autoscaling rules
- Database connection pooling
- Read replicas
- Cache cluster sizing
- Queue cluster sizing
- Worker autoscaling
- Health checks
- Circuit breakers
- Rate limiting
- Bulkheads
- Backpressure
- Timeout configuration
- Retry policies
- Secrets/config management
- Deployment safety
- Blue/green or canary support
- Disaster recovery readiness

G. Database protection
Check for:
- Missing indexes
- N+1 query problems
- Unbounded queries
- Large table scans
- Long-running transactions
- Lock contention risks
- Missing pagination
- Missing query limits
- Missing connection pool limits
- Unsafe direct DB fallback patterns
- Read/write separation
- Heavy analytics queries on transactional DB

H. Scalability violation report
Create a structured violation report with the following fields:

For every violation:
- File path
- Function/class/module
- Line number if available
- Violation type:
  - Direct DB read without cache
  - Direct DB write without queue
  - Unsafe cache fallback
  - Missing cache repopulation
  - Missing cache invalidation
  - Missing queue retry
  - Missing DLQ
  - Missing idempotency
  - Missing monitoring
  - Missing admin control
  - Missing rate limit
  - Missing backpressure
  - Database bottleneck
  - Infrastructure bottleneck
- Severity:
  - Critical
  - High
  - Medium
  - Low
- Why it matters at 10M users / 1,000 TPS
- Recommended fix
- Estimated implementation complexity
- Suggested test coverage

I. Scoring
Produce a scalability score from 0 to 100 for:
- Read scalability
- Write scalability
- Cache architecture
- Queue architecture
- Database safety
- Admin operability
- Monitoring/observability
- Infrastructure readiness
- Failure resilience
- Overall production readiness

Also provide:
- Total violation count
- Critical violation count
- High violation count
- Medium violation count
- Low violation count
- Top 10 changes required before production scale
- Top 10 quick wins

J. Implementation plan
After the audit, propose an implementation plan in phases:

Phase 1: Critical safety fixes
- Prevent database overload
- Add missing cache-first reads
- Add queue-based writes for high-volume flows
- Add basic cache/queue monitoring

Phase 2: Operational controls
- Add admin dashboard for cache and queue
- Add feature flags/configuration
- Add DLQ visibility and retry controls
- Add fallback monitoring

Phase 3: Scale hardening
- Add autoscaling
- Add rate limiting
- Add circuit breakers
- Add backpressure
- Add load tests

Phase 4: Production validation
- Add load testing for 1,000 TPS
- Add chaos testing for cache failure
- Add chaos testing for queue failure
- Add database failover testing
- Add dashboard alerts

K. Code changes
If safe, implement the recommended changes directly.
Before changing behavior, explain the change.
Do not remove existing business logic.
Preserve existing tests.
Add tests for every changed path.
Prefer small, focused changes.
Avoid introducing unnecessary dependencies.

For implementation, create or improve:
- Cache abstraction layer if missing
- Queue abstraction layer if missing
- Read-through cache helper
- Safe DB fallback helper
- Cache repopulation logic
- Queue producer wrapper
- Idempotent queue consumer pattern
- Retry and DLQ handling
- Metrics collection
- Admin dashboard/API endpoints
- Configuration model for cache and queue settings
- Load test scripts
- Documentation

L. Expected final output
Return the final answer in this structure:

1. Executive summary
2. Current scalability assessment
3. Architecture diagram in text form
4. Violation summary table
5. Detailed violation list
6. Cache review
7. Queue review
8. Database review
9. Infrastructure review
10. Admin interface review
11. Monitoring and alerting review
12. Recommended target architecture
13. Code changes made
14. Tests added or updated
15. Remaining risks
16. 30-day scalability improvement roadmap
17. Final production readiness score

Important architectural expectation:
Reads should be cache-first with safe DB fallback and cache repopulation.
Writes should be queue-first where possible, with durable processing, idempotency, retries, DLQ, and cache invalidation.
Direct database access should be minimized, measured, justified, and visible in monitoring.
Admin users must be able to monitor and configure cache and queue behavior safely.
```

## Optional modes

Use this line at the top if you want Claude Code to audit only and not modify files:

```text
Audit only. Do not change code yet. Produce the full scalability report and implementation plan first.
```

Use this line at the top if you want Claude Code to make safe changes immediately:

```text
After completing the audit, implement the highest-impact safe changes directly, add tests, and summarize every file changed.
```
