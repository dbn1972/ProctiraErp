# Deep Integration Test Prompt for Claude Code

Copy and paste this prompt into Claude Code at the root of your codebase.

---

```text
You are a world-class senior QA architect, principal engineer, SDET lead, and production reliability engineer.

Your task is to deeply analyze this codebase and create a complete integration testing strategy across all modules of the product.

Do not perform a shallow test review.
Inspect the actual code, module boundaries, APIs, services, database interactions, cache interactions, queue/event flows, authentication, authorization, admin flows, external integrations, background jobs, and configuration.

Your goal is to verify whether all modules work correctly together in real production-like conditions.

====================================================================
1. UNDERSTAND THE SYSTEM
====================================================================

First, understand the product and identify:

- All major modules
- Module responsibilities
- Module dependencies
- Internal APIs between modules
- External APIs
- Shared database tables
- Shared cache keys
- Queue/event producers
- Queue/event consumers
- Background workers
- Admin modules
- Authentication and authorization flows
- Critical user journeys
- Business-critical transactions
- Error and retry flows
- Configuration dependencies
- Feature flags
- Third-party services

Create a module map showing:

- Module name
- Purpose
- Inputs
- Outputs
- Dependencies
- Data owned
- APIs exposed
- Events published
- Events consumed
- Failure risks

====================================================================
2. INTEGRATION TEST OBJECTIVE
====================================================================

Design and implement a full deep integration test suite that verifies:

- Modules communicate correctly
- Data flows correctly across modules
- Authentication and authorization work across modules
- Database writes and reads remain consistent
- Cache behavior is correct
- Queue/event processing works correctly
- Background jobs process correctly
- Admin actions affect the correct modules
- Error handling works across module boundaries
- Retry behavior works correctly
- Rollback and compensation logic works where needed
- External services are mocked or sandboxed safely
- No module breaks another module silently

The test suite should detect real production issues, not only simple unit-level bugs.

====================================================================
3. MODULE INTEGRATION DISCOVERY
====================================================================

Inspect the code and identify all module-to-module flows.

For each flow, document:

- Source module
- Target module
- Trigger
- API/function/event used
- Data passed
- Database tables affected
- Cache keys affected
- Queue topics affected
- Expected output
- Failure behavior
- Test coverage status

Classify each integration as:

- Critical
- High
- Medium
- Low

Critical integrations include:

- Login/authentication
- User registration
- Payment/order/transaction flows
- Permission and role checks
- Data creation/update/delete flows
- Admin configuration changes
- Queue-based writes
- Cache invalidation
- Notifications
- Reports
- External API calls
- Any flow that can cause data loss, financial loss, security risk, or user-blocking failure

====================================================================
4. TEST TYPES TO CREATE
====================================================================

Create or improve the following test types:

A. Module-to-module integration tests
- Verify service A correctly calls service B.
- Verify data contracts between modules.
- Verify module output is accepted by downstream modules.

B. API integration tests
- Test real API routes/controllers with real service layer.
- Validate request/response schema.
- Validate authentication and authorization.
- Validate error responses.

C. Database integration tests
- Use a real test database where possible.
- Validate migrations.
- Validate constraints.
- Validate transactions.
- Validate rollback behavior.
- Validate data consistency across tables.

D. Cache integration tests
- Validate cache read/write behavior.
- Validate cache miss fallback.
- Validate cache repopulation.
- Validate cache invalidation after writes.
- Validate stale cache behavior.
- Validate cache failure behavior.

E. Queue/event integration tests
- Validate event publishing.
- Validate event payload schema.
- Validate consumer processing.
- Validate retry behavior.
- Validate dead-letter queue behavior.
- Validate idempotency.
- Validate duplicate message handling.
- Validate poison message handling.

F. Background job integration tests
- Validate scheduled jobs.
- Validate worker execution.
- Validate job retries.
- Validate job failure handling.
- Validate job idempotency.

G. External service integration tests
- Use mocks, stubs, contract tests, or sandbox environments.
- Validate timeout behavior.
- Validate retry behavior.
- Validate degraded behavior.
- Validate response mapping.

H. Admin integration tests
- Validate admin configuration changes.
- Validate RBAC.
- Validate audit logs.
- Validate cache/queue/database controls.
- Validate dangerous action confirmation.
- Validate rollback of config changes where supported.

I. Security integration tests
- Validate cross-module authorization.
- Validate users cannot access other users' data.
- Validate admin-only actions are protected.
- Validate tokens/sessions work correctly.
- Validate permission changes take effect immediately.

J. Failure integration tests
- Simulate database failure.
- Simulate cache failure.
- Simulate queue failure.
- Simulate external API timeout.
- Simulate partial module failure.
- Validate graceful degradation.

====================================================================
5. CRITICAL USER JOURNEY TESTING
====================================================================

Identify and test complete end-to-end business flows across multiple modules.

For each critical journey, create tests for:

- Happy path
- Invalid input
- Unauthorized access
- Partial failure
- Retry
- Duplicate request
- Concurrent request
- Cache miss
- Queue delay
- Database error
- External API timeout
- Rollback or compensation

For every journey, document:

- Modules involved
- Test data required
- Expected database state
- Expected cache state
- Expected queue messages
- Expected API response
- Expected logs/metrics
- Failure expectations

====================================================================
6. DATA CONSISTENCY TESTING
====================================================================

Verify that data remains consistent across modules.

Check:

- Create/update/delete operations
- Transaction boundaries
- Rollback behavior
- Eventual consistency behavior
- Duplicate event handling
- Idempotency keys
- Cache invalidation
- Derived data updates
- Audit log creation
- Report data accuracy
- User permission changes
- Race conditions
- Concurrent writes

Create tests for:

- Same request submitted twice
- Two users updating same entity
- Queue consumer receives duplicate message
- Cache contains stale data after update
- Database transaction fails halfway
- External API succeeds but local DB fails
- Local DB succeeds but external API fails

====================================================================
7. CONTRACT TESTING
====================================================================

For every module boundary, verify contracts.

Check:

- Request schema
- Response schema
- Event schema
- Error schema
- Required fields
- Optional fields
- Data types
- Enum values
- Version compatibility
- Backward compatibility
- Breaking change detection

Create contract tests for:

- Internal APIs
- Public APIs
- Queue messages
- Webhooks
- Third-party callbacks
- Admin APIs

If contract testing tooling is not present, recommend and/or add a lightweight contract testing approach.

====================================================================
8. TEST ENVIRONMENT REQUIREMENTS
====================================================================

Set up or validate a production-like integration test environment.

The environment should include:

- Test database
- Test cache
- Test queue/message broker
- Test object storage if used
- Mocked or sandboxed third-party services
- Test secrets/configuration
- Test admin user
- Test normal user
- Test restricted user
- Test background workers
- Isolated test data
- Repeatable database reset/seed strategy

Tests must be:

- Repeatable
- Isolated
- Deterministic where possible
- Safe to run in CI/CD
- Independent of production data
- Clear when failure occurs

====================================================================
9. CI/CD INTEGRATION
====================================================================

Review and improve CI/CD integration testing.

Check:

- Are integration tests run on every pull request?
- Are critical integration tests blocking merge?
- Are slower integration tests run nightly or before release?
- Are test containers/services started automatically?
- Are test failures easy to debug?
- Are logs/artifacts captured?
- Is flaky test detection present?
- Are migrations tested in CI?
- Are contract tests run in CI?
- Are queue/cache tests run in CI?

Recommend test stages:

1. Fast integration tests on every PR
2. Full integration suite before merge or release
3. Nightly deep integration suite
4. Release candidate validation suite

====================================================================
10. OBSERVABILITY IN TESTS
====================================================================

Integration tests should verify not only output, but also operational signals.

Where possible, check:

- Logs are emitted
- Metrics are updated
- Traces contain correct span names
- Errors are reported safely
- Queue metrics change correctly
- Cache hit/miss metrics are recorded
- Audit logs are created
- Admin actions are traceable
- Failure events are visible

====================================================================
11. NEGATIVE AND EDGE CASE TESTING
====================================================================

Create tests for:

- Missing required fields
- Invalid data types
- Unauthorized users
- Expired sessions
- Invalid tokens
- Duplicate requests
- Concurrent updates
- Large payloads
- Empty responses
- Slow dependencies
- Partial dependency failure
- Malformed queue messages
- Stale cache
- Deleted referenced data
- Permission changes during active session
- Migration compatibility
- Feature flag on/off states

====================================================================
12. TEST COVERAGE REPORT
====================================================================

Produce a detailed integration test coverage report.

For each module, include:

- Module name
- Integration points
- Existing test coverage
- Missing test coverage
- Critical untested flows
- Risk level
- Recommended tests
- Priority
- Files to create or update

Use this format:

| Module | Integration Point | Existing Coverage | Missing Tests | Risk | Priority | Recommended Test |
|---|---|---|---|---|---|---|

====================================================================
13. IMPLEMENTATION INSTRUCTIONS
====================================================================

If safe, implement the integration tests directly.

Rules:

- Do not remove existing tests.
- Do not weaken assertions.
- Do not mock everything if real integration is required.
- Prefer real test database/cache/queue where practical.
- Mock only external third-party services unless sandbox is available.
- Keep tests isolated and repeatable.
- Add test data factories or fixtures where useful.
- Add clear assertions for database, cache, queue, and API behavior.
- Add cleanup/reset logic.
- Avoid flaky timing-based tests.
- Use polling with timeout for async queue tests.
- Add documentation for how to run the tests.

If implementation is too risky or too large, produce the full test plan and implement the highest-priority safe tests first.

====================================================================
14. VIOLATION REPORT
====================================================================

Report integration testing gaps as violations.

For each violation, include:

- ID
- Module
- Integration point
- File path if available
- Violation type:
  - Missing integration test
  - Missing API contract test
  - Missing database integration test
  - Missing cache integration test
  - Missing queue integration test
  - Missing failure-path test
  - Missing authorization test
  - Missing admin integration test
  - Missing external service test
  - Missing CI/CD integration
  - Flaky test risk
  - Poor test isolation
- Severity:
  - Critical
  - High
  - Medium
  - Low
- Why it matters
- Recommended test
- Suggested test file
- Test data required
- Expected assertions
- Release blocking: Yes / No

====================================================================
15. FINAL OUTPUT FORMAT
====================================================================

Return the final answer in this exact structure:

1. Executive summary
2. Product/module understanding
3. Module dependency map
4. Critical integration flows
5. Existing integration test assessment
6. Missing integration test coverage
7. Database integration test plan
8. Cache integration test plan
9. Queue/event integration test plan
10. API integration test plan
11. Admin integration test plan
12. External service integration test plan
13. Security/authorization integration test plan
14. Failure and resilience integration test plan
15. CI/CD integration recommendation
16. Detailed violation report
17. Tests implemented, if any
18. Files changed, if any
19. How to run the tests
20. Remaining risks
21. Recommended next steps
22. Final integration readiness score from 0 to 100

====================================================================
16. SCORING
====================================================================

Score the integration readiness from 0 to 100 across:

- Module coverage
- Critical journey coverage
- API integration coverage
- Database integration coverage
- Cache integration coverage
- Queue/event integration coverage
- Admin integration coverage
- Security/authorization coverage
- Failure-path coverage
- CI/CD integration
- Test isolation and reliability
- Overall integration readiness

Use this rating:

- 90 to 100: World-class integration test coverage
- 80 to 89: Strong but needs improvement
- 70 to 79: Acceptable but risky for large scale
- 60 to 69: Weak coverage
- Below 60: Not production ready

Do not say the platform has world-class integration quality unless:
- All critical module flows have integration tests
- All critical APIs have integration tests
- Auth and authorization are tested across modules
- Database/cache/queue behavior is tested
- Failure paths are tested
- CI/CD blocks unsafe changes
- Tests are repeatable and isolated
```

---

## Optional line: audit only

Add this at the top if you do not want Claude Code to change files:

```text
Audit only. Do not modify files. Produce the full integration testing gap report, module map, test plan, and readiness score.
```

---

## Optional line: implementation mode

Add this at the top if you want Claude Code to create the tests:

```text
After completing the audit, implement the highest-priority integration tests directly. Add test fixtures, test data setup, and documentation for how to run the tests.
```
