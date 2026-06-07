# Docker Infrastructure

This directory contains Docker configurations for building and deploying ProctiraERP Unified Platform services.

## Directory Structure

```
infrastructure/docker/
├── Dockerfile.api-gateway        # API Gateway (Fastify)
├── Dockerfile.backend-service    # Generic backend service (parameterized)
├── Dockerfile.etl-worker         # ETL Worker service
├── Dockerfile.nextjs-app         # Generic Next.js app (parameterized)
├── Dockerfile.web                # Main web application (Next.js standalone)
├── docker-compose.services.yml   # Microservices deployment compose
└── README.md                     # This file
```

## Deployment Modes

### 1. Monolithic (Default for Development)

All backend services run inside the API Gateway as Fastify plugins:

```bash
# From monorepo root
docker compose up
```

### 2. Microservices (Production)

Each backend service runs independently with its own container:

```bash
# Start infrastructure first
docker compose up postgres redis kafka rabbitmq minio

# Start individual services
docker compose -f infrastructure/docker/docker-compose.services.yml up
```

## Building Individual Services

### Backend Services

Use the generic `Dockerfile.backend-service` with build args:

```bash
# Build institution service
docker build \
  -f infrastructure/docker/Dockerfile.backend-service \
  --build-arg SERVICE_NAME=institution \
  --build-arg SERVICE_PORT=3020 \
  -t proctira/institution-service .

# Build student service
docker build \
  -f infrastructure/docker/Dockerfile.backend-service \
  --build-arg SERVICE_NAME=student \
  --build-arg SERVICE_PORT=3021 \
  -t proctira/student-service .
```

### Next.js Applications

Use the generic `Dockerfile.nextjs-app` with build args:

```bash
# Build registration portal
docker build \
  -f infrastructure/docker/Dockerfile.nextjs-app \
  --build-arg APP_NAME=registration-portal \
  --build-arg APP_PORT=3002 \
  -t proctira/registration-portal .
```

### API Gateway

```bash
docker build \
  -f infrastructure/docker/Dockerfile.api-gateway \
  -t proctira/api-gateway .
```

### ETL Worker

```bash
docker build \
  -f infrastructure/docker/Dockerfile.etl-worker \
  -t proctira/etl-worker .
```

## Service Port Assignments

| Service              | Port |
|---------------------|------|
| API Gateway         | 3000 |
| Web App             | 3001 |
| Registration Portal | 3002 |
| Public Website      | 3003 |
| Admin Console       | 3004 |
| Developer Portal    | 3005 |
| ETL Worker          | 3010 |
| Institution Service | 3020 |
| Student Service     | 3021 |
| Staff Service       | 3022 |
| Assessment Service  | 3023 |
| Attendance Service  | 3024 |
| Examination Service | 3025 |
| Workflow Service    | 3026 |
| Notification Service| 3027 |
| Report Service      | 3028 |
| Install Wizard      | 3100 |

## Environment Variables

All services read configuration from environment variables. See `.env.example` at the monorepo root for the complete list. Key categories:

- **Database**: `DATABASE_URL`
- **Redis**: `REDIS_URL`
- **Kafka**: `KAFKA_BROKERS`
- **RabbitMQ**: `RABBITMQ_URL`
- **Auth/JWT**: `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`
- **Object Storage**: `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`
- **Service-specific**: `PORT`, `HOST`, `LOG_LEVEL`, `NODE_ENV`

## Health Checks

All service containers include Docker HEALTHCHECK instructions:

- **Fastify services**: `GET /health` — returns service status, uptime
- **Next.js apps**: `GET /api/health` — returns application status
- **Readiness probe**: `GET /ready` — confirms service can accept traffic

Health check configuration:
- Interval: 30s
- Timeout: 5s
- Start period: 15-20s
- Retries: 3

## Multi-Stage Build Optimization

All Dockerfiles use multi-stage builds:

1. **base** — Minimal Node.js + pnpm setup
2. **deps** — Workspace dependency installation (cached layer)
3. **builder** — Type-checking and production build
4. **runner** — Lean runtime with only production artifacts

This approach ensures:
- Small final images (Alpine-based)
- Efficient Docker layer caching
- No dev dependencies in production
- No secrets baked into images
- Non-root user execution
