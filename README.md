# Zeyoo Backend

Modular-monolith backend for the Zeyoo creator-marketing platform. One deployable
NestJS application over a single PostgreSQL database. See
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) for the full architecture.

## Stack

- **NestJS 11** (TypeScript, strict)
- **PostgreSQL 16** via **Prisma**
- **Redis** (BullMQ jobs, realtime, rate limiting)
- **In-house auth** — Passport JWT access tokens + rotating refresh tokens, argon2 hashing

## Prerequisites

- Node.js 22+
- pnpm (via `corepack enable`)
- PostgreSQL and Redis (locally: `docker compose -f docker/docker-compose.dev.yml up -d`)

## Getting started

```bash
pnpm install
cp .env.example .env          # then fill in real secrets
pnpm prisma migrate deploy    # apply migrations to the database
pnpm prisma:generate          # generate the Prisma client
pnpm seed                     # optional: create the initial admin user
pnpm dev                      # API on http://localhost:3000/v1
```

OpenAPI docs are served at `http://localhost:3000/docs`.

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Run the API with reload |
| `pnpm dev:worker` | Run the background worker |
| `pnpm build` | Compile to `dist/` (rewrites path aliases) |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm lint` | ESLint (includes module-boundary rule) |
| `pnpm test` | Unit + DI-graph tests |
| `pnpm test:e2e` | End-to-end tests against a running Postgres |
| `pnpm openapi:export` | Write `openapi.json` for client-SDK generation |

## Module layout

Bounded contexts live under `src/modules/*`; each exposes a `*.public.ts` barrel
that is the only surface other modules may import (enforced by ESLint). Shared
kernel code (config, database, auth, rbac, http) lives under `src/platform/*`.

Modules: **iam** (auth, orgs, teams, roles, API keys), **campaigns**
(lifecycle, discovery, invitations, categories), **creators** (profiles,
verification, social accounts, directory), **applications** (apply, review),
**submissions** (content + review workflow), **payments** (hexagonal:
double-entry ledger, funding, withdrawals), **billing** (Stripe subscriptions),
**notifications**, **social** (metric ingestion), **media** (assets + clips),
**fraud** (rules-based risk), **analytics** (campaign reports), **disputes**,
**admin**, and **ai** (Claude-backed assistants).

## Testing

Unit tests run with no infrastructure. The end-to-end suite boots the whole app
against a local Postgres and exercises every module's endpoints, mocking only the
external gateways (Stripe, Anthropic). Point it at a database with
`E2E_DATABASE_URL` (defaults to `postgresql://zeyoo@127.0.0.1:5544/zeyoo`), then:

```bash
pnpm prisma db push   # sync schema to the test database
pnpm test:e2e
```
