# ProctiraERP Legacy Migration Scripts

Migration tools for transferring data from the legacy ProctiraERP MySQL/CakePHP system to the new PostgreSQL/Prisma platform.

## Overview

The migration process follows these steps:

1. **Bulk Transfer** — pgloader copies raw data from MySQL to a PostgreSQL staging schema
2. **Schema Transformation** — Maps legacy CakePHP table/column names to new Prisma model conventions
3. **UUID Generation** — Replaces legacy integer primary keys with UUIDs while preserving relationships
4. **Tenant Assignment** — Assigns all migrated data to a default tenant for multi-tenancy
5. **Validation** — Verifies row counts, referential integrity, and constraint compliance

## Prerequisites

- PostgreSQL 15+ with `uuid-ossp` extension
- pgloader 3.6+ (for bulk MySQL → PostgreSQL transfer)
- Node.js 20+
- Access to legacy MySQL database
- Target PostgreSQL database with Prisma schema applied

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

## Usage

```bash
# Run full migration pipeline
pnpm migrate:all

# Or run individual steps:
pnpm migrate:bulk       # Step 1: pgloader bulk transfer
pnpm migrate:transform  # Step 2: Schema transformation
pnpm migrate:uuids      # Step 3: UUID generation
pnpm migrate:tenant     # Step 4: Tenant assignment
pnpm migrate:validate   # Step 5: Validation

# Post-migration tools:
pnpm migrate:report       # Generate comprehensive migration report
pnpm migrate:constraints  # Validate against schema constraints
pnpm migrate:cdc-sync     # Run CDC incremental sync cycle
```

## Legacy Table Mapping

| Legacy Table (MySQL) | New Table (PostgreSQL) | Notes |
|---------------------|----------------------|-------|
| `institutions` | `institutions` | Service-prefixed in queries |
| `institution_students` | `enrollments` | Enrollment lifecycle |
| `security_users` (type=student) | `students` | Split by user type |
| `security_users` (type=staff) | `staff` | Split by user type |
| `area_administratives` | `geographic_areas` | Hierarchy preserved |
| `academic_periods` | `academic_periods` | Direct mapping |
| `education_grades` | `grades` | Simplified |
| `institution_classes` | `classes` | Institution-scoped |
| `institution_subjects` | `institution_subjects` | Grade linkage |

## Architecture

```
tools/migrations/
├── pgloader/                    # pgloader configuration files
│   └── proctira-migration.load  # Main pgloader config
├── src/
│   ├── config.ts               # Migration configuration
│   ├── types.ts                # Shared type definitions
│   ├── pgloader-config.ts      # pgloader config generator
│   ├── transform-schema.ts     # Schema transformation logic
│   ├── generate-uuids.ts       # UUID generation for legacy PKs
│   ├── assign-tenant.ts        # Default tenant assignment
│   ├── validate-migration.ts   # Post-migration validation
│   ├── migration-report.ts     # Comprehensive migration reporting
│   ├── constraint-validator.ts # Schema constraint validation
│   ├── cdc-sync.ts             # Kafka-based CDC incremental sync
│   ├── parallel-operation.ts   # Parallel operation management
│   ├── run-full-migration.ts   # Orchestrates full pipeline
│   ├── run-report.ts           # Runner: migration report
│   ├── run-constraint-validation.ts  # Runner: constraint validation
│   ├── run-cdc-sync.ts         # Runner: CDC incremental sync
│   └── table-mappings.ts       # Legacy → new table/column maps
└── .env.example                # Environment variable template
```

## Migration Report (Requirement 24.3)

Generates a comprehensive report listing:
- Tables processed with row counts and throughput metrics
- Rows successfully migrated per table
- Unmigrated data with specific reasons (constraint violations, missing references, enum mismatches, etc.)

```bash
pnpm migrate:report
```

## Schema Constraint Validation (Requirement 24.5)

Validates migrated data against new PostgreSQL schema constraints **without halting** the migration:
- NOT NULL constraints on required columns
- UNIQUE constraints (duplicate detection)
- Foreign key integrity
- Enum value validity
- String length limits

```bash
pnpm migrate:constraints
```

## CDC Incremental Sync (Requirement 24.4)

Kafka-based Change Data Capture for keeping legacy MySQL and new PostgreSQL in sync during parallel operation:
- Timestamp-based change detection from legacy system
- Publishes change events to tenant-prefixed Kafka topics
- Applies changes to PostgreSQL with conflict resolution (source_wins, target_wins, latest_wins)
- Tracks sync position per table for resumability

```bash
pnpm migrate:cdc-sync
```

### CDC Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `KAFKA_BROKERS` | `localhost:9092` | Kafka broker addresses |
| `CDC_TOPIC_PREFIX` | `cdc.migration` | Topic prefix for CDC events |
| `CDC_POLL_INTERVAL_MS` | `5000` | Polling interval |
| `CDC_BATCH_SIZE` | `1000` | Max events per poll |
| `CDC_CONFLICT_RESOLUTION` | `source_wins` | Conflict strategy |

## Parallel Operation

The migration supports parallel operation of both systems through a phased approach:

1. **initial_sync** — Full migration, all traffic to legacy
2. **dual_write** — Writes go to both systems via CDC
3. **shadow_read** — 50% reads from new system for validation
4. **cutover** — All traffic to new system
5. **legacy_decommission** — Legacy system shutdown
