# Security Policy

ProctiraERP handles multi-tenant education workflows and may process sensitive child, student, guardian, staff, health, academic, identity, and financial information. Please report security and privacy concerns privately and avoid exposing affected people or systems.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/dbn1972/ProctiraErp/security/advisories/new). **Do not open a public issue, discussion, or pull request for a suspected vulnerability.**

If private reporting is unavailable, contact the repository owner through an established private channel and ask for a secure reporting route without including vulnerability details in the initial message.

Useful reports include:

- a concise description and potential impact;
- affected component, version, commit, deployment type, and prerequisites;
- safe reproduction steps or a minimal proof of concept;
- whether tenant boundaries, authorization, child data, credentials, exports, payments, webhooks, files, or supply-chain integrity may be affected;
- suggested mitigation, if known.

Use synthetic identifiers and redact tokens, secrets, personal data, hostnames, and customer details. Do not access more data than needed to establish the issue. Do not download, retain, alter, or publish real child or personal data.

## What to expect

Maintainers will acknowledge and triage reports through the private advisory. Timing depends on severity, reproducibility, affected releases, and deployment coordination; this policy does not promise a fixed remediation date. Maintainers may request clarification, coordinate a fix and release, and agree on disclosure timing and credit with the reporter.

Please keep details confidential until maintainers confirm that affected users have had a reasonable opportunity to update. Public disclosure must not expose credentials, personal data, tenant details, or exploit-ready information for an unmitigated issue.

## Scope and priorities

Reports are especially important when they involve:

- cross-tenant or cross-institution access;
- authentication, authorization, session, impersonation, or privilege bypass;
- exposure of student, child, guardian, health, counselling, disability, custody, academic, staff, or financial data;
- insecure reports, exports, uploads, object storage, mobile/offline storage, caches, queues, logs, or backups;
- secret, signing-key, API-key, webhook, payment, dependency, build, or artifact compromise;
- destructive data changes, audit-history loss, or unsafe migrations;
- denial of service against critical school workflows.

The actively maintained default branch and releases identified by maintainers receive security review. Repository version numbers alone do not establish a long-term support commitment. Ask privately if support status for a specific release is unclear.

## Immediate incident concerns

For a suspected leaked credential, active compromise, or cross-tenant exposure, clearly mark the private report as urgent. Operators should revoke or rotate affected credentials, contain access, preserve safe audit evidence, and follow the applicable incident process. Do not paste secrets or affected records into the report.

## Good-faith research

Good-faith research should stay within accounts and tenants you own or are explicitly authorized to test, minimize disruption, respect privacy, and stop when sensitive data or service instability is encountered. This policy does not authorize testing third-party systems, social engineering, physical attacks, denial of service, or access beyond permission, and it does not make legal or regulatory assurances.
