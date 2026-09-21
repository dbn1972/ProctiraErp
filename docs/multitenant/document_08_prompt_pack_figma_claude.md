# Document 8 — Prompt Pack for Figma Make + Claude

How to use Volumes 1–7 to design and build Data Vault and Consent Manager

This document is the working prompt pack that turns your specification suite into practical execution steps for design and build teams. It is intended to be used with Figma Make for product design and Claude or Claude Code for review, API mock generation, and implementation scaffolding.

Source specification suite:

- Volume 1 — Platform Charter and Governance Standard
- Volume 2 — Full Product Specification
- Volume 3 — System Design Specification
- Volume 4 — API and Developer Platform Specification
- Volume 5 — Security and Compliance Control Matrix
- Volume 6 — Installation and Operations Guide
- Volume 7 — Plugin and Theme Extension Specification

# 1. Why this is the right path

You are on the right path because you already separated platform law, product behavior, architecture, APIs, security, operations, and extensibility into distinct volumes. That is how serious enterprise platforms are designed. This prompt pack helps you convert those documents into practical execution with two tools:

- Figma Make for information architecture, design system, key screens, public website, legal and trust surfaces, and clickable prototypes.
- Claude for review, critique, copywriting, mock APIs, and implementation if you use Claude Code.

# 2. What I need from you before using the prompts

Before you run any tool, fill in the following project brief. This gives both Figma Make and Claude the business context they need to generate useful output.

Product: Data Vault / Consent Manager / Both
Priority: design / clickable prototype / frontend / backend / full build
Deployment: SaaS / self-hosted / private cloud / source-download
Brand style:
Target users:
Top 10 MVP features:
Required roles:
Required integrations:
Compliance targets:
Preferred stack:
Design references:
Start with: Figma / Claude / Both

# 3. How to use the documents

Use the seven volumes as a controlled source of truth.

# 4. One file to create first

Before you run Figma Make or Claude, create a short file called MASTER_BUILD_BRIEF.md. It should be no more than 1–2 pages and should summarize the essentials from Volumes 1–7.

# MASTER_BUILD_BRIEF.md

- Product name
- One-paragraph vision
- Target users
- Top 10 must-have features
- Deployment model
- Main roles
- Main screens
- Supported adapters
- Key integrations
- Visual style preference
- What is in MVP and what is out

# 5. Which tool to use for what

# 6. Exact order to follow

1. Fill in the project brief and create MASTER_BUILD_BRIEF.md.
1. Attach Volumes 1–7 and the brief to Figma Make, then run the Figma prompts in order.
1. Review the output in Claude and capture missing screens, weak flows, and enterprise blockers.
1. Use Claude to generate mock APIs and seed data for prototyping.
1. If you are building code, point Claude Code at the repo and run the implementation prompts in order.
1. Feed review findings back into Figma Make for UX changes and back into Claude Code for code changes.

# 7. Prompt pack for Figma Make

Run the following prompts in Figma Make in the order shown.

## 7.1 Master product design prompt

You are designing a world-class enterprise multi-tenant cloud product based on the attached specification set, Volumes 1–7.

Use these documents as the source of truth:

- Volume 1: Platform Charter and Governance Standard
- Volume 2: Full Product Specification
- Volume 3: System Design Specification
- Volume 4: API and Developer Platform Specification
- Volume 5: Security and Compliance Control Matrix
- Volume 6: Installation and Operations Guide
- Volume 7: Plugin and Theme Extension Specification

Goal:
Design a premium enterprise SaaS product experience that is trustworthy, secure, highly configurable, API-first, installable, and extensible through themes and plugins.

Product characteristics:

- multi-tenant
- enterprise-grade
- API-first
- secure by default
- installable / self-hostable where supported
- service-oriented architecture
- adapter-based infrastructure
- plugin and theme enabled
- developer portal included
- admin, security, compliance, and operator workflows included
- legal/trust/public website surfaces included

Design output required:

1. Product-wide information architecture
2. Core app shell
3. End-user application screens
4. Tenant admin console
5. Security/compliance console
6. Developer portal
7. Installation/bootstrap flow
8. Theme management UI
9. Plugin marketplace / plugin management UI
10. Public website pages
11. Legal / trust / privacy pages
12. Footer structure
13. Design system and component library
14. Responsive desktop-first layouts
15. Empty, loading, error, and restricted-access states

Design principles:

- premium enterprise SaaS
- high-trust visual language
- clear information hierarchy
- calm, precise, modern
- accessibility-first
- multilingual-ready
- legal and trust discoverability built in
- safe handling of destructive actions
- suitable for CIOs, CISOs, compliance teams, tenant admins, developers, and operators

Include these major product areas:

- login and SSO
- dashboard
- tenant/workspace navigation
- user and role management
- policy management
- audit trail browser
- queue and async operations visibility
- installation and environment setup
- infrastructure adapter configuration
- API credentials and service accounts
- docs/dev portal
- plugin registry and lifecycle
- theme preview/publish/rollback
- public site, security page, trust page, privacy policy, terms, legal, contact

Important:
Do not design a generic admin template.
Make this feel like a category-defining enterprise platform with excellent spacing, typography, tables, filters, audit views, and configuration flows.

## 7.2 Design system prompt

Create a full enterprise design system for this product.

Include:

- tokens for color, typography, spacing, radius, shadows, borders, motion
- layout rules
- data-dense table patterns
- admin patterns
- form patterns
- audit log patterns
- dangerous action patterns
- role/permission badges
- plugin/theme management patterns
- install/setup stepper patterns
- legal page templates
- footer and public website navigation patterns

Support:

- accessibility
- long translations
- RTL-safe spacing
- tenant branding through controlled themes

Use a premium enterprise visual language:

- calm
- secure
- precise
- global
- modern
- highly legible

## 7.3 Main app shell prompt

Design the core application shell for the product.

Include:

- tenant switcher
- workspace selector
- global search
- notifications
- language selector
- environment indicator
- help/docs access
- profile/session menu
- left navigation with product areas
- permission-aware nav visibility
- clear tenant and region context

The shell should support:

- admin workflows
- developer workflows
- compliance workflows
- operator workflows

Make it feel premium, clean, scalable, and enterprise-ready.

## 7.4 Installation and bootstrap UX prompt

Design the installation and bootstrap experience for operators.

Include setup flow for:

- CDN
- database adapter selection: MySQL or PostgreSQL
- object storage: S3 or S3-compatible
- cache: Redis
- queue adapter: SQS, Kafka, or RabbitMQ
- initial admin creation
- auth/SSO bootstrap
- health checks
- configuration validation
- failure and retry UX
- safe completion summary

Also include:

- upgrade path UX
- configuration review screen
- secret entry / validation UX
- environment readiness dashboard

## 7.5 Plugin and theme management prompt

Design the plugin and theme management experience.

Include:

- plugin registry
- plugin detail page
- install/enable/disable/upgrade/rollback
- permission disclosure
- compatibility matrix
- audit visibility
- tenant scope visibility
- theme token editor
- theme preview/publish/rollback
- protected zones for legal/security UI that themes cannot override
- marketplace/distribution style UI if relevant

Make this look enterprise-safe and governance-first, not like a consumer app store.

## 7.6 Public website prompt

Design the full public website for this product.

Include:

- home page
- product page
- developer portal page
- installation page
- security page
- compliance/trust page
- privacy policy
- terms of service
- cookie policy
- legal page
- contact page
- status page
- footer with complete legal and trust discoverability

Make it premium, enterprise, credible, and globally deployable in tone and structure.

# 8. Prompt pack for Claude

Use Claude for review, enterprise critique, copy refinement, and mock API generation.

## 8.1 Design and product review prompt

You are reviewing a world-class enterprise multi-tenant platform design and specification set.

Use these materials as source of truth:

- Volume 1: Platform Charter and Governance Standard
- Volume 2: Full Product Specification
- Volume 3: System Design Specification
- Volume 4: API and Developer Platform Specification
- Volume 5: Security and Compliance Control Matrix
- Volume 6: Installation and Operations Guide
- Volume 7: Plugin and Theme Extension Specification

Also review the attached Figma output or screen descriptions.

Your role:

- enterprise product reviewer
- UX reviewer
- platform architecture reviewer
- security/compliance reviewer

Review the design against the spec and tell me:

1. Where the design violates the spec
2. What is missing or under-designed
3. What would confuse enterprise admins, developers, or operators
4. What looks unsafe, weak, or non-enterprise
5. What would block adoption by a Fortune 500 customer
6. What legal/trust/public website items are missing
7. What plugin/theme/install/developer portal flows are incomplete
8. What should change before beta

Return the answer in this format:

- Critical issues
- High-priority issues
- Medium-priority issues
- Recommended next design iterations
- Screens that must be added
- Copy/UX improvements

## 8.2 API mock and seed data prompt

Create a product-aligned mock API specification for a world-class enterprise multi-tenant platform based on Volumes 1–7.

The API should support:

- authentication
- sessions
- tenants
- organizations/workspaces
- users and groups
- roles and permissions
- subscriptions/entitlements
- settings and configuration
- installation/bootstrap
- themes/branding
- plugins
- developer keys/service accounts
- audit events
- webhooks/events
- health/readiness
- queue/messaging management

Requirements:

1. Use a versioned REST structure
2. Make every endpoint tenant-aware where relevant
3. Define request and response shapes
4. Define error model
5. Define pagination model
6. Define auth model
7. Define idempotency behavior where needed
8. Include JSON examples
9. Include mock records for:
   - tenant
   - user
   - role
   - plugin
   - theme
   - install config
   - queue adapter config
   - audit event
10. Include sample API endpoints for:

- login
- current tenant
- users
- roles
- plugins
- themes
- installation status
- queue adapter validation
- audit events

Return:

- API structure
- endpoint list
- JSON payload examples
- example error responses
- mock seed data for frontend prototyping

# 9. Prompt pack for Claude Code

Use this section only if you are using Claude Code or another code-capable coding agent inside your repository.

## 9.1 Master implementation prompt

You are implementing a world-class enterprise multi-tenant platform from the attached specification set in /specs.

Treat the spec set as binding:

- Volume 1 defines platform rules and non-negotiables
- Volume 2 defines product behavior
- Volume 3 defines system design and service boundaries
- Volume 4 defines APIs and developer platform behavior
- Volume 5 defines security and compliance controls
- Volume 6 defines installation and operations behavior
- Volume 7 defines plugin and theme extension behavior

Implementation goals:

1. Scaffold a production-grade monorepo
2. Create service boundaries consistent with the spec
3. Enforce service-owned tables and service-prefixed table names
4. Prevent cross-service SQL joins
5. Support adapter-based infrastructure:
   - database: MySQL/PostgreSQL
   - object storage: S3-compatible
   - cache: Redis
   - queue: SQS/Kafka/RabbitMQ
6. Provide a frontend app for:
   - product console
   - tenant admin
   - security/compliance
   - developer portal
   - installation/setup
   - plugin and theme management
   - public website
7. Create API contracts and example endpoints consistent with Volume 4
8. Add tests, linting, and developer setup
9. Add docs for local development and installation

Recommended stack:

- frontend: React + TypeScript + Tailwind
- backend: service-oriented architecture with clear service boundaries
- APIs: versioned REST APIs
- auth: tenant-aware auth and RBAC/ABAC support
- docs: markdown docs in /docs

Deliverables:

- repo structure
- architecture README
- initial services
- frontend shell
- public website shell
- developer portal shell
- install/setup flow
- sample adapters
- sample plugin framework
- tests and local run instructions

Rules:

- do not collapse everything into one service
- do not bypass service boundaries
- do not introduce cross-service joins
- do not hardcode a single queue/provider into core logic
- do not violate Volumes 1–7
- explain major architectural choices in docs

## 9.2 Frontend shell prompt

Build the frontend application shell based on the design and spec.

Include routes for:

- login
- dashboard
- tenant admin
- users and roles
- policies
- audit
- developer portal
- installation
- plugins
- themes
- public website
- legal/trust pages

Use a clean enterprise UI architecture and mock data first.

## 9.3 Service scaffold prompt

Create the initial service map and code skeleton for:

- identity service
- tenant service
- policy service
- audit service
- plugin service
- theme service
- installation/config service
- developer portal service
- queue abstraction layer

Each service must:

- own its own tables
- use service-prefixed tables
- expose explicit APIs
- have basic tests
- document ownership

## 9.4 Adapter layer prompt

Implement a ports-and-adapters infrastructure layer.

Create interfaces and starter adapters for:

- MySQL
- PostgreSQL
- S3-compatible storage
- Redis
- SQS
- Kafka
- RabbitMQ

Add configuration, health checks, and contract tests.

## 9.5 Install flow prompt

Build the install/bootstrap product flow.

Include:

- environment validation
- database adapter selection
- object storage config
- Redis config
- queue adapter config
- initial admin bootstrap
- success/failure states
- audit of install actions

## 9.6 Plugin and theme framework prompt

Build the plugin and theme framework.

Include:

- plugin manifest schema
- plugin registry model
- enable/disable lifecycle
- permission model
- audit hooks
- theme token model
- preview/publish/rollback
- protected UI zones that themes cannot override

# 10. Product-specific prompts

Use the following when you want to focus specifically on Data Vault or Consent Manager rather than the shared platform.

## 10.1 Data Vault — Figma Make prompt

Design a world-class enterprise multi-tenant product called Data Vault.

Use the attached Volumes 1–7 as the source of truth.

Data Vault is a secure, API-first, multi-tenant, installable cloud platform for storing, governing, searching, classifying, versioning, auditing, and protecting documents and digital assets. It supports plugins, themes, developer APIs, self-hosted installation, and enterprise admin/compliance workflows.

Design the following:

- product information architecture
- app shell
- dashboard
- vault explorer
- document detail
- user and role management
- policy management
- audit and compliance console
- developer portal
- installation/bootstrap flow
- infrastructure adapter configuration
- plugin registry and plugin lifecycle UI
- theme management with preview/publish/rollback
- public website
- trust, legal, privacy, contact, and footer pages

Requirements:

- enterprise-grade
- high-trust visual language
- multilingual-ready
- accessibility-first
- admin, developer, operator, and compliance friendly
- safe destructive actions
- legal and trust discoverability built in

Include support for:

- MySQL/PostgreSQL
- S3-compatible storage
- Redis
- SQS/Kafka/RabbitMQ
- tenant-aware roles and policies
- self-hosted setup
- service-oriented platform model

Do not generate a generic admin template.
Make it feel premium, operationally serious, and category-defining.

## 10.2 Data Vault — Claude review prompt

Review the attached Volumes 1–7 and the current Data Vault design output.

Act as:

- enterprise product reviewer
- UX reviewer
- platform architect
- security/compliance reviewer

Assess:

1. Missing screens
2. Missing workflows
3. Where the design violates the platform rules
4. What would block enterprise adoption
5. Weak trust, admin, install, plugin, API, or audit flows
6. What should change before prototype approval

Return:

- Critical issues
- High-priority issues
- Medium-priority issues
- Recommended design iterations
- Missing screens
- Copy improvements

## 10.3 Data Vault — Claude API mock prompt

Create a mock API specification and seed data for Data Vault based on Volumes 1–7.

Include:

- authentication
- tenants
- vaults
- documents
- versions
- users
- roles
- policies
- audit events
- plugins
- themes
- installation status
- adapter configuration
- queue adapter validation

Return:

- endpoint list
- request/response shapes
- error model
- pagination model
- JSON examples
- frontend mock seed data

## 10.4 Consent Manager — Figma Make prompt

Design a world-class enterprise multi-tenant product called Consent Manager.

Use the attached Volumes 1–7 as the source of truth.

Consent Manager is a secure, API-first, multi-tenant, installable cloud platform for collecting, storing, synchronizing, auditing, and enforcing user consent and preference records across websites, apps, backend systems, cookies, communications channels, and third-party tools. It supports plugins, themes, developer APIs, self-hosted installation, and enterprise privacy/compliance workflows.

Design the following:

- product information architecture
- app shell
- privacy/compliance dashboard
- consent records explorer
- data subject / identity view
- preference center management
- consent banner management
- policy/rules management
- audit and compliance console
- developer portal
- installation/bootstrap flow
- infrastructure adapter configuration
- plugin registry and plugin lifecycle UI
- theme management with preview/publish/rollback
- public website
- trust, legal, privacy, contact, and footer pages

Requirements:

- enterprise-grade
- privacy-first visual language
- multilingual-ready
- accessibility-first
- admin, developer, privacy, legal, and operator friendly
- region-aware compliance workflows
- legal and trust discoverability built in

Include support for:

- MySQL/PostgreSQL
- S3-compatible storage where needed
- Redis
- SQS/Kafka/RabbitMQ
- API-based consent sync
- role-based and policy-based access
- self-hosted setup
- service-oriented architecture

Do not generate a generic admin template.
Make it feel like a category-defining enterprise privacy platform.

## 10.5 Consent Manager — Claude review prompt

Review the attached Volumes 1–7 and the current Consent Manager design output.

Act as:

- enterprise product reviewer
- privacy/compliance reviewer
- UX reviewer
- platform architect

Assess:

1. Missing screens
2. Missing consent and preference workflows
3. Weak privacy/trust/legal surfaces
4. What would block enterprise adoption
5. Weak admin, audit, install, plugin, API, or compliance flows
6. What should change before prototype approval

Return:

- Critical issues
- High-priority issues
- Medium-priority issues
- Recommended design iterations
- Missing screens
- Copy improvements

## 10.6 Consent Manager — Claude API mock prompt

Create a mock API specification and seed data for Consent Manager based on Volumes 1–7.

Include:

- authentication
- tenants
- users
- identities
- consent records
- preference records
- consent banners
- policy rules
- audit events
- plugins
- themes
- installation status
- adapter configuration
- queue adapter validation

Return:

- endpoint list
- request/response shapes
- error model
- pagination model
- JSON examples
- frontend mock seed data

# 11. Recommended execution path

If you are building both products, start with Data Vault first. It gives you the stronger platform base, which Consent Manager can then reuse for tenancy, auth, adapters, install flow, audit, plugins, themes, developer portal, and public site structure.

1. Start with Data Vault and finalize the shared platform shell.
1. Lock the design system, app shell, install flow, plugin/theme patterns, and public website patterns.
1. Use those shared patterns to adapt the product for Consent Manager.
1. Review both outputs against the same Volumes 1–7 to keep them aligned.

# 12. Short checklist before you start

- Fill the project brief.
- Create MASTER_BUILD_BRIEF.md.
- Put Volumes 1–7 in one folder and attach them to the tool where possible.
- Use Figma Make first for design.
- Use Claude second for review and API mocks.
- Use Claude Code third for implementation if you are building code.
- Keep one decision log so product, design, and engineering stay aligned.

# 13. Final note

The strongest pattern is: design in Figma Make, review in Claude, mock APIs in Claude, and implement in Claude Code. That keeps design, platform law, developer surfaces, installation, and extensibility aligned to the same specification stack.

## Tables

### Table 1

| Volume   | How to use it                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Volume 1 | Rules you cannot break: multi-tenancy, security, service boundaries, installability, adapters, plugins, themes, legal and trust requirements. |
| Volume 2 | Full product behavior: personas, packaging, workflows, feature scope, user journeys, KPIs, and roadmap.                                       |
| Volume 3 | System shape: services, data boundaries, queues, deployment model, and architecture decisions.                                                |
| Volume 4 | Developer surface: APIs, portal behavior, contracts, endpoint groups, SDK expectations.                                                       |
| Volume 5 | Trust layer: security controls, compliance mapping, audit expectations, evidence paths.                                                       |
| Volume 6 | Operator surface: installation, bootstrap, upgrade, rollback, monitoring, and support boundaries.                                             |
| Volume 7 | Extensibility model: plugin framework, theme rules, marketplace patterns, extension safety.                                                   |

### Table 2

| Tool              | Use it for                                                                                                                            | Do not use it as                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Figma Make        | Information architecture, design system, app shell, key screens, installation UX, plugin/theme UI, public website, legal/trust pages. | Your backend or service architect.               |
| Claude (chat/app) | Review, critique, copywriting, API mock generation, risk review, enterprise readiness feedback.                                       | Your primary visual designer.                    |
| Claude Code       | Repo scaffolding, frontend implementation, service skeletons, adapter layer, install flow, plugin/theme framework.                    | Your product strategist or visual design engine. |
