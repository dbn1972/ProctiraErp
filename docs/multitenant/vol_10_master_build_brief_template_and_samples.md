# Document 10 — MASTER_BUILD_BRIEF Template + Samples

_Reusable team template plus filled examples for Data Vault and Consent Manager_
Purpose: give product, design, engineering, and AI-tooling teams a short, reusable working brief they can attach alongside Volumes 1–7 and use with Figma Make, Claude, or coding agents.

# How to use this document

1. Copy the template section into a new file named MASTER_BUILD_BRIEF.md.
2. Fill only what is known; leave unknown items as [TBD].
3. Keep the brief to 1–2 pages for active project work.
4. Attach the brief together with Volumes 1–7 when using Figma Make or Claude.
5. Use the filled Data Vault and Consent Manager examples in this document as reference quality.

# Part A — Reusable MASTER_BUILD_BRIEF.md template

Copy the markdown below into a file named MASTER_BUILD_BRIEF.md.

```md
# MASTER_BUILD_BRIEF.md

## 1. Product Overview

**Product Name:** [Enter product name]
**Product Type:** [Multi-tenant SaaS / Installable enterprise product / Other]
**One-Line Summary:** [One sentence]
**Vision Statement:** [What the product aims to become]
**Why This Product Exists:** [Problem and reason]
**Primary Business Goal:** [MVP / Enterprise adoption / Platform foundation / Other]

## 2. Product Scope

**Current Phase:** [Discovery / Design / MVP / Beta / GA / Expansion]
**Priority Right Now:** [Design / Prototype / Frontend / Backend / Full build]
**In Scope for This Phase:** [5 bullets max]
**Out of Scope for This Phase:** [3 bullets max]
**Definition of MVP:** [What must exist for first usable release]

## 3. Target Users

**Primary Users:** [List]
**Secondary Users:** [List]
**Buyer / Decision Maker:** [List]

## 4. Core User Roles

- Platform Admin: [Responsibility]
- Tenant Admin: [Responsibility]
- Org Admin: [Responsibility]
- Security Admin: [Responsibility]
- Compliance Admin: [Responsibility]
- Developer / Integrator: [Responsibility]
- End User: [Responsibility]
- External User: [If applicable]

## 5. Top 10 Must-Have Features

1. [Feature]
2. [Feature]
3. [Feature]
4. [Feature]
5. [Feature]
6. [Feature]
7. [Feature]
8. [Feature]
9. [Feature]
10. [Feature]

## 6. Main User Journeys

### Journey 1

**Name:** [Journey name]
**Goal:** [What success looks like]
**Main Steps:** 1) [Step] 2) [Step] 3) [Step]

### Journey 2

**Name:** [Journey name]
**Goal:** [What success looks like]
**Main Steps:** 1) [Step] 2) [Step] 3) [Step]

### Journey 3

**Name:** [Journey name]
**Goal:** [What success looks like]
**Main Steps:** 1) [Step] 2) [Step] 3) [Step]

## 7. Main Screens / Product Surfaces

**Application Screens:** [List]
**Public Website Screens:** [List]

## 8. Deployment Model

**Supported Deployment Model:** [SaaS / Private Cloud / Self-Hosted / Source-Download]
**Primary Deployment for This Phase:** [Choose one]
**Installation Required in V1:** [Yes / No]
**Operator / Installation Experience Needed:** [Short description]

## 9. Infrastructure Adapters

**Database:** [MySQL / PostgreSQL]
**Object Storage:** [S3 / S3-compatible]
**Cache:** [Redis]
**Queue / Messaging:** [SQS / Kafka / RabbitMQ]
**CDN:** [CloudFront / Cloudflare / Configurable]
**Optional Adapters:** [Search / Email / SMS / KMS / Observability]

## 10. API and Developer Requirements

**API Style:** [REST / GraphQL / REST first]
**Developer Portal Needed:** [Yes / No]
**SDKs Needed:** [List]
**Webhooks / Events Needed:** [Yes / No]
**Service Accounts Needed:** [Yes / No]
**Plugin SDK Needed:** [Yes / No]

## 11. Security and Compliance Expectations

**Required Security Features:** [List]
**Compliance Targets:** [List]
**Public Trust Pages Required:** [Security / Trust / Privacy / Terms / Legal / Contact]

## 12. Plugin and Theme Requirements

**Themes Required:** [Yes / No]
**Branding Scope:** [List]
**Plugins Required in V1:** [Yes / No]
**Plugin Categories Expected:** [List]
**Marketplace Needed:** [Yes / No / Later]

## 13. Integrations

**Required Integrations:** [List]
**Nice-to-Have Integrations:** [List]

## 14. Design Direction

**Brand Style:** [Premium enterprise / Trust-first / Privacy-first / Other]
**Tone of Voice:** [Clear / secure / calm / global]
**Design References:** [List]
**Accessibility Requirement:** [WCAG 2.1 AA]
**Localization Requirement:** [Languages / multilingual / RTL]

## 15. Technical Preferences

**Preferred Frontend Stack:** [Example]
**Preferred Backend Style:** [Example]
**Preferred Hosting Model:** [Example]
**Preferred Auth Approach:** [Example]
**Preferred Repo Structure:** [Monorepo / Polyrepo]

## 16. Product Constraints

**Hard Constraints:** [List]
**Known Risks:** [List]
**Dependencies:** [List]

## 17. Success Criteria

**MVP Success Looks Like:** [3 outcomes]
**Product KPIs:** [5 KPIs]

## 18. Notes for Design / Build Tools

Use this brief together with Volumes 1–7 and the prompt pack documents.

## 19. Approval

**Prepared By:** [Name]
**Date:** [Date]
**Approved By:** [Name / Team]
**Version:** [v0.1 / v1.0]
```

# Part B — Sample MASTER_BUILD_BRIEF for Data Vault

## 1. Product Overview

| Field                 | Value                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product Name          | Data Vault                                                                                                                                        |
| Product Type          | Multi-tenant enterprise SaaS and installable platform for secure document and digital asset governance                                            |
| One-Line Summary      | A secure, API-first, multi-tenant platform for storing, governing, searching, classifying, versioning, and auditing documents and digital assets. |
| Vision Statement      | Build a world-class enterprise data vault platform trusted by global organizations to securely manage high-value documents and digital assets.    |
| Primary Business Goal | Launch an enterprise-ready MVP that proves secure storage, governance, installability, and developer/API readiness.                               |

## 2. Product Scope

| Field              | Value                                                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current Phase      | MVP Design and Build                                                                                                                                                                |
| Priority Right Now | Clickable prototype and frontend-first product design, followed by platform/backend scaffolding                                                                                     |
| Definition of MVP  | A usable product that supports secure document storage, metadata, version history, audit trails, tenant-aware admin controls, install/bootstrap, and a basic developer/API surface. |

### In Scope for This Phase

- Tenant-aware document vaulting
- Metadata and classification
- Versioning and search
- Roles, permissions, and audit
- Installation/bootstrap, developer portal, plugin/theme foundations

### Out of Scope for This Phase

- Full marketplace monetization
- Advanced AI classification
- Complex cross-region failover automation

## 3. Target Users

- Primary users: Tenant Admin, Compliance/Records Manager, Security Admin, End User/Knowledge Worker, Developer/Integrator
- Secondary users: Operator/Platform Engineer, Support Engineer, External Auditor
- Buyer / decision maker: CIO, CTO, CISO, Head of Compliance, VP Engineering

## 4. Core User Roles

- Platform Admin — operates the global platform and high-level environments
- Tenant Admin — manages tenant setup, branding, users, permissions, and settings
- Security Admin — manages SSO, MFA, sessions, and sensitive access policies
- Compliance Admin — reviews audit trails, retention, legal hold, and evidence exports
- Developer / Integrator — uses APIs, webhooks, service accounts, and plugins
- End User — uploads, searches, views, and collaborates within allowed boundaries

## 5. Top 10 Must-Have Features

1. Secure tenant-scoped document storage
2. Metadata and schema support
3. Version history
4. Search and filtering
5. Role-based and policy-based access
6. Audit trail and event history
7. Installation/bootstrap flow
8. Developer portal and API credentials
9. Theme and branding controls
10. Plugin lifecycle foundation

## 6. Main User Journeys

- Tenant onboarding — provision tenant, configure base settings, create first admin
- Document ingestion and governance — upload document, assign metadata/classification, store/version/audit
- Developer integration — access portal, create service account, call APIs and receive events

## 7. Main Screens / Product Surfaces

- Application: Login/SSO, Dashboard, Vault Explorer, Document Detail, Version History, Users and Roles, Policies, Audit Console, Developer Portal, Installation, Plugins, Themes, Billing, Reports
- Public website: Home, Product, Security, Trust/Compliance, Installation, Developer Portal, Privacy Policy, Terms, Legal, Contact, Status

## 8–17. Key Configuration Summary

| Field                   | Value                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Deployment Model        | SaaS, Private Cloud, Self-Hosted, Source-Download; primary for this phase: SaaS-first with self-hosted-aware design     |
| Infrastructure Adapters | MySQL/PostgreSQL, S3/S3-compatible, Redis, SQS/Kafka/RabbitMQ, configurable CDN                                         |
| Developer Requirements  | REST-first APIs, developer portal, TypeScript/Python/Java SDKs, webhooks/events, service accounts, plugin SDK           |
| Compliance Targets      | GDPR, SOC 2, ISO 27001                                                                                                  |
| Public Trust Pages      | Security, Trust, Privacy Policy, Terms of Service, Cookie Policy, Legal, Contact                                        |
| Plugin/Theme Needs      | Themes required; plugins required in V1 foundation; marketplace later                                                   |
| Design Direction        | Premium enterprise, trust-first, operationally serious; references: Okta, Datadog, Stripe, Atlassian                    |
| Technical Preferences   | React + TypeScript + Tailwind, service-oriented architecture, cloud-native, OIDC + SAML + local fallback, monorepo      |
| Success KPIs            | Time to first tenant activation, first document upload, first API call, MFA/SSO enablement rate, bootstrap success rate |

# Part C — Sample MASTER_BUILD_BRIEF for Consent Manager

## 1. Product Overview

| Field                 | Value                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product Name          | Consent Manager                                                                                                                                           |
| Product Type          | Multi-tenant enterprise SaaS and installable privacy/consent governance platform                                                                          |
| One-Line Summary      | A secure, API-first, multi-tenant platform for collecting, storing, synchronizing, enforcing, and auditing user consent and preference records.           |
| Vision Statement      | Build a world-class enterprise privacy and consent platform trusted by global organizations to manage consent and compliance across channels and systems. |
| Primary Business Goal | Launch a privacy-first MVP that proves consent lifecycle management, policy enforcement, auditability, installability, and API readiness.                 |

## 2. Product Scope

| Field              | Value                                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current Phase      | MVP Design and Build                                                                                                                                                                            |
| Priority Right Now | Clickable prototype and full product design, followed by API and platform scaffolding                                                                                                           |
| Definition of MVP  | A usable product that supports consent capture configuration, consent record storage, preference views, auditability, policy-driven admin control, install/bootstrap, and APIs for integration. |

### In Scope for This Phase

- Consent record store
- Preference center model
- Consent banner management
- Identity and consent linking
- Rules/policy management
- Audit and compliance, installation/bootstrap, developer portal, plugin/theme foundations

### Out of Scope for This Phase

- Advanced AI-driven compliance insights
- Full CMP marketplace ecosystem
- Deep cross-border automation packs

## 3. Target Users

- Primary users: Privacy Admin, Compliance Manager, Security Admin, Developer/Integrator, Tenant Admin
- Secondary users: Legal Team, Marketing Operations, Operator/Platform Engineer, Support Engineer
- Buyer / decision maker: CPO, DPO, CISO, CIO, CTO, VP Engineering

## 4. Core User Roles

- Platform Admin — operates shared platform and high-level environments
- Tenant Admin — manages tenant settings, branding, users, permissions, and regional setup
- Privacy Admin — manages consent banners, preference models, and policy rules
- Security Admin — manages auth, MFA, SSO, sessions, and scoped access
- Compliance Admin — reviews audit, evidence, and regulatory workflows
- Developer / Integrator — integrates consent APIs, event flows, and external systems

## 5. Top 10 Must-Have Features

1. Consent record store
2. Preference record management
3. Consent banner configuration
4. Policy/rules management
5. Identity-to-consent linking
6. Audit trail and evidence
7. Role-based and policy-based access
8. Installation/bootstrap flow
9. Developer portal and APIs
10. Theme and branding controls

## 6. Main User Journeys

- Tenant privacy setup — create tenant, configure identity/auth and regional settings, set default consent/policy model
- Consent capture and record lifecycle — configure banner/preference flow, capture user choice, persist auditable record
- External system synchronization — configure integration, trigger consent event/update, sync and audit downstream delivery

## 7. Main Screens / Product Surfaces

- Application: Login/SSO, Privacy Dashboard, Consent Records Explorer, Identity/Subject View, Preference Center Management, Banner Management, Policy/Rules Management, Audit Console, Developer Portal, Installation, Plugins, Themes, Billing, Reports
- Public website: Home, Product, Security, Trust/Compliance, Installation, Developer Portal, Privacy Policy, Terms, Legal, Contact, Status

## 8–17. Key Configuration Summary

| Field                   | Value                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Deployment Model        | SaaS, Private Cloud, Self-Hosted, Source-Download; primary for this phase: SaaS-first with self-hosted-aware design              |
| Infrastructure Adapters | MySQL/PostgreSQL, S3/S3-compatible, Redis, SQS/Kafka/RabbitMQ, configurable CDN                                                  |
| Developer Requirements  | REST-first APIs, developer portal, TypeScript/Python/Java SDKs, webhooks/events, service accounts, plugin SDK                    |
| Compliance Targets      | GDPR, SOC 2, ISO 27001, cookie/privacy-law readiness                                                                             |
| Public Trust Pages      | Security, Trust, Privacy Policy, Terms of Service, Cookie Policy, Legal, Contact                                                 |
| Plugin/Theme Needs      | Themes required; plugins required in V1 foundation; marketplace later                                                            |
| Design Direction        | Privacy-first, premium enterprise, compliance-trust focused; references: OneTrust, Okta, Stripe, Vercel                          |
| Technical Preferences   | React + TypeScript + Tailwind, service-oriented architecture, cloud-native, OIDC + SAML + local fallback, monorepo               |
| Success KPIs            | Time to first consent configuration, first live consent capture, first downstream sync, bootstrap success rate, audit usage rate |

# Team guidance

- Keep the active brief to 1–2 pages.
- Mark unknown items as [TBD] instead of guessing.
- Update the brief before each major design or build phase.
- Use the brief together with Volumes 1–7, Document 8, and Document 9.
