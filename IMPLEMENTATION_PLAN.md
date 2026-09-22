# Zeyoo Backend — Implementation Plan

**Repo:** `zeyoo-be`
**Scope:** Backend platform for the Zeyoo creator-marketing product (web + mobile + admin clients).
**Architecture:** **Modular monolith** — one deployable application, one PostgreSQL database, clean in-process module boundaries.
**Status:** Draft for review · Last updated 2026-09-22

> Companion document: `../Zeyoo_System_Design.md` (whole-system design). This plan supersedes that document's backend section: **no microservices, no database-per-service.** Module boundaries are kept clean so a context *could* be extracted later, but the system runs as a single service against a single database until scale actually demands otherwise.

---

## 1. Guiding decisions

| Concern | Decision | Rationale |
|---|---|---|
| Deployment unit | **Single NestJS application** (+ a worker process from the same codebase) | One thing to build, deploy, trace, and debug. No network hops between domains. |
| Modularity | **Bounded-context modules inside one app** | Domain isolation without distributed-systems cost. Enforced by lint boundaries, not by the network. |
| Module internals | **Flat layout by default; hexagonal only for `payments` & `fraud`** | Ports-and-adapters ceremony only where rules are intricate and implementations are genuinely swapped/tested-in-isolation; plain services elsewhere (ADR-0005, §5.1–5.2). |
| Database | **One PostgreSQL database** | Cross-module reads/joins and transactions are trivial and correct. Foreign keys allowed across modules. |
| Data ownership | Each module **owns its tables**; other modules reach them only through the owning module's service API (in-process), never by importing another module's repositories | Keeps the seam clean for a future extraction, while allowing DB-level FKs. |
| ORM | **Prisma** (single schema, split by feature files) | Type-safe, great migrations/DX. |
| Async work | **Transactional outbox → BullMQ (Redis)** consumed by a worker | Reliable side effects without Kafka. Same repo, separate entrypoint. |
| Domain events | **In-process event bus** (NestJS `EventEmitter`) for synchronous reactions; **outbox** for anything that must survive a crash | Simplicity now; durable where it matters (money, notifications). |
| Scheduling | **BullMQ repeatable jobs** + `@nestjs/schedule` | Metric polling, reconciliation, report generation. |
| API | **REST + JSON**, versioned `/v1`, **OpenAPI** auto-generated | Public "Open API" deliverable (contract §1.7); typed clients for web/mobile generated from the spec. |
| Realtime | **WebSocket gateway** (Socket.IO) backed by Redis pub/sub | Submission status, earnings, fraud alerts. |
| Auth | **In-house** — NestJS + Passport, JWT access + rotating refresh tokens, RBAC owned by the app | Full control, no per-MAU cost, no identity lock-in. Enterprise **SAML/OIDC** added via `passport-saml` / `openid-client` when needed (§1.7). |
| Money/KYC | **Stripe** (Checkout, Connect, Billing, Identity, Tax) | PCI/payout/KYC stay with Stripe; app keeps a reconciliation ledger only. |

**What we are explicitly NOT doing now:** Kafka, Temporal, gRPC, service mesh, per-service databases, ClickHouse. These are noted as *future extraction points* in §12, not built.

---

## 2. Technology stack

- **Runtime:** Node.js 22 LTS, TypeScript (strict).
- **Framework:** NestJS 11 (modules, DI, guards, interceptors, pipes).
- **ORM/DB:** Prisma + PostgreSQL 16.
- **Cache / queue / pubsub:** Redis 7 (BullMQ jobs, rate-limit, realtime fanout, idempotency keys).
- **Validation:** Zod at the edges (DTO parsing) + `nestjs-zod`; Prisma types internally.
- **Auth:** in-house — `@nestjs/passport` + `passport-jwt`, `argon2` password hashing, JWT access tokens + rotating refresh tokens (stored/revocable in DB), social login via OAuth (`passport-google-oauth20`, Apple), enterprise `passport-saml`/`openid-client` added later; custom RBAC.
- **Payments:** `stripe` SDK — Checkout, Connect, Billing, Identity, Tax.
- **Media:** Mux SDK (upload, transcode, clip) + S3/R2 for originals.
- **AI:** `@anthropic-ai/sdk` (Claude) for briefs/ideas/coaching/disclosure checks.
- **Email/Push:** Resend (email), Expo Push / FCM / APNs (mobile push).
- **Observability:** OpenTelemetry traces, Pino structured logs, Sentry errors, Prometheus `/metrics`.
- **Testing:** Jest (unit), Supertest (e2e/HTTP), Testcontainers (real Postgres/Redis in integration tests).
- **Tooling:** pnpm, ESLint (+ boundary rules), Prettier, Husky + lint-staged, Docker Compose for local infra.

---

## 3. Runtime topology

```
                         ┌──────────────────────────────┐
   web / mobile / admin → │      API process (HTTP)       │  NestJS app: controllers,
        (REST + WSS)      │  controllers → services →     │  guards, WS gateway
                          │  repositories → Postgres       │
                          └───────────────┬───────────────┘
                                          │ writes domain events + outbox rows
                                          ▼
                          ┌──────────────────────────────┐
                          │        PostgreSQL (single)     │  all module tables +
                          │        + outbox table          │  outbox
                          └───────────────┬───────────────┘
                                          │ outbox poller enqueues
                                          ▼
                          ┌──────────────────────────────┐
   Stripe/social/Mux ⇄    │      Worker process            │  BullMQ consumers,
   Claude/email/push      │  (same codebase, worker main)  │  scheduled jobs,
                          │  jobs → services → Postgres    │  webhook follow-ups
                          └────────────────────────────────┘
                                          ▲
                                   Redis (BullMQ + pubsub)
```

- **Two entrypoints, one codebase:** `main.ts` (HTTP + WS API) and `worker.ts` (BullMQ processors + schedulers). Both import the same modules, so business logic is written once.
- **Transactional outbox:** a domain write and its outbox row commit in the **same DB transaction**; a poller relays outbox rows to BullMQ. Guarantees "state changed ⇒ side effect will happen," without Kafka.

---

## 4. Module map (bounded contexts, in one app)

Each module = a NestJS module = a bounded context. Modules expose a **service facade**; other modules depend on that facade, never on the internals.

| Module | Owns | Key responsibilities |
|---|---|---|
| `iam` | users, credentials, sessions/refresh_tokens, orgs, teams, memberships, roles, api_keys | Login/registration, password hashing + reset, JWT issue/refresh/revoke, social + (later) SAML/OIDC login, session → internal principal, RBAC, org/team management, API-key issuance & scopes |
| `campaigns` | campaigns, invitations, categories | Campaign lifecycle (draft→published→closed), public publishing, private invites, discovery queries |
| `creators` | creator_profiles, social_accounts, verifications | Profile, identity-verification status (Stripe Identity), social account connections |
| `applications` | applications | Apply/invite acceptance, approve/decline, term acceptance |
| `submissions` | submissions, submission_revisions, reviews | Content upload/link, status workflow (pending → needs_changes → approved), review actions |
| `payments` | ledger_accounts, ledger_entries, funding, withdrawals, holds | Stripe orchestration, **double-entry ledger**, earnings calc, withdrawal review, payout holds |
| `billing` | subscriptions, plans | Stripe Billing tiers for brands (§1.7) |
| `social` | metric_snapshots, oauth_tokens | Social platform adapters, scheduled metric polling, snapshots |
| `media` | media_assets, clips | Mux upload/transcode/clip orchestration, moderation status (§1.11) |
| `fraud` | risk_signals, risk_scores, cases | Rules engine, risk scoring inputs, payout-timing decisions, flagged-activity cases (§1.8) |
| `analytics` | (reads across modules) | Dashboards, downloadable campaign reports (§1.2), aggregates |
| `notifications` | notifications, notification_prefs | Multi-channel dispatch (in-app/email/push), preferences (§1.6) |
| `ai` | ai_requests (audit) | Claude-backed briefs/ideas/coaching/disclosure checks (§1.2/1.3/1.9) |
| `disputes` | disputes, dispute_events | Dispute & appeal center with SLA timers, escalation (§1.10) |
| `admin` | (reads/acts across modules) | Admin console API: manage entities, payout review, settings, audit access (§1.4) |

**Cross-cutting (not business modules):**
`platform/` — shared kernel: Prisma client, config, auth guards, RBAC, event bus, outbox, BullMQ setup, audit log, error handling, logging, OpenAPI, health checks.

### Dependency rule
- Business modules may depend on `platform/*` freely.
- Business modules may depend on another business module **only via its exported service facade**, and dependency direction is kept acyclic (enforced by an ESLint boundaries rule + `nestjs-spelunker` check in CI).
- No module imports another module's Prisma repository or DTO internals.

---

## 5. Proposed folder structure

```
zeyoo-be/
├─ src/
│  ├─ main.ts                      # HTTP + WebSocket API bootstrap
│  ├─ worker.ts                    # BullMQ worker + scheduler bootstrap
│  ├─ app.module.ts                # root module: imports all feature + platform modules
│  │
│  ├─ platform/                    # shared kernel (no business logic)
│  │  ├─ config/                   # env schema (Zod), typed ConfigService
│  │  ├─ database/                 # PrismaModule, PrismaService, transaction helper
│  │  ├─ auth/                     # JWT strategy/guard, @CurrentUser, session → principal
│  │  ├─ rbac/                     # roles, permissions, @RequirePermission, PolicyGuard
│  │  ├─ events/                   # in-process EventBus, event base types
│  │  ├─ outbox/                   # OutboxService, outbox poller, relay to BullMQ
│  │  ├─ queue/                    # BullMQ module, queue registry, job base classes
│  │  ├─ realtime/                 # Socket.IO gateway + Redis adapter
│  │  ├─ audit/                    # append-only audit_log writer + query API
│  │  ├─ http/                     # global filters, interceptors, pagination, idempotency
│  │  ├─ observability/            # OpenTelemetry, Pino logger, Sentry, /metrics
│  │  └─ openapi/                  # Swagger setup, spec export script
│  │
│  ├─ modules/
│  │  ├─ iam/                      # STANDARD layout (flat) — see §5.1
│  │  │  ├─ iam.module.ts
│  │  │  ├─ iam.public.ts          # barrel: the ONLY things other modules may import
│  │  │  ├─ controllers/           # HTTP controllers
│  │  │  ├─ services/              # use-cases = the module's public facade
│  │  │  ├─ dto/                   # Zod request/response schemas
│  │  │  ├─ events/                # emit + handle domain events
│  │  │  └─ jobs/                  # BullMQ processors owned by this module
│  │  ├─ campaigns/                # STANDARD layout
│  │  ├─ creators/                 # STANDARD layout
│  │  ├─ applications/             # STANDARD layout
│  │  ├─ submissions/              # STANDARD layout
│  │  ├─ payments/                 # HEXAGONAL layout — see §5.2
│  │  ├─ billing/                  # STANDARD layout
│  │  ├─ social/                   # STANDARD layout
│  │  ├─ media/                    # STANDARD layout
│  │  ├─ fraud/                    # HEXAGONAL layout — see §5.2
│  │  ├─ analytics/                # STANDARD layout (mostly read-only)
│  │  ├─ notifications/            # STANDARD layout
│  │  ├─ ai/                       # STANDARD layout
│  │  ├─ disputes/                 # STANDARD layout
│  │  └─ admin/                    # STANDARD layout
│  │
│  └─ webhooks/                    # thin controllers: Stripe, Mux, social
│                                   # verify signature → enqueue → 200 fast
│
├─ prisma/
│  ├─ schema/                      # split schema files (prismaSchemaFolder)
│  │  ├─ schema.prisma             # datasource, generator, enums
│  │  ├─ iam.prisma
│  │  ├─ campaigns.prisma
│  │  ├─ payments.prisma
│  │  └─ …one file per module…
│  ├─ migrations/                  # generated SQL migrations (source of truth)
│  └─ seed.ts                      # dev/test seed data
│
├─ test/
│  ├─ e2e/                         # Supertest HTTP flows
│  ├─ integration/                 # Testcontainers (real Postgres + Redis)
│  └─ fixtures/
│
├─ scripts/                        # spec export, migration helpers, one-off tasks
├─ docker/                         # Dockerfile(s), docker-compose.dev.yml
├─ .github/workflows/              # CI: lint, typecheck, test, build, migrate-check
├─ openapi.json                    # generated, committed for client-SDK generation
├─ .env.example
├─ package.json
├─ tsconfig.json
└─ README.md
```

### Two layouts, chosen per module (ADR-0005)

Modules are **not** all structured the same way. The full ports-and-adapters ceremony earns its keep only where domain rules are intricate and an implementation will genuinely be swapped or must be tested without infrastructure. Everywhere else it is pure overhead. So:

- **Standard (flat) layout — the default for ~13 of 15 modules.** Services talk to Prisma directly. Prisma *is* the persistence layer; pretending it's swappable would be fiction we never exercise.
- **Hexagonal layout — only `payments` and `fraud`.** These define domain ports and bind swappable adapters via DI.

The **one thing every module keeps regardless** is `*.public.ts` + the ESLint boundary rule — that barrel is the module's entire cross-module surface and is what actually holds the modular monolith together. The internal layout is a module-local choice; the boundary is not.

#### 5.1 Standard (flat) layout — default

```
campaigns/
├─ campaigns.module.ts
├─ campaigns.public.ts     # exported facade — the ONLY import surface for other modules
├─ controllers/            # HTTP: *.controller.ts (thin; validation + delegate)
├─ services/               # use-cases; the facade re-exported by *.public.ts
├─ dto/                    # Zod schemas + inferred types
├─ events/                 # emit domain events; handle events from other modules
└─ jobs/                   # BullMQ processors owned by this module
```

Rules: controllers stay thin; a service may inject `PrismaService` directly; DTOs are Zod; Prisma models are the domain types (no separate hand-written entities). Not every folder is mandatory — a read-only module like `analytics` may have no `jobs/` or `events/`.

#### 5.2 Hexagonal layout — `payments` and `fraud` only

The business core is pure (no Nest/Prisma/Stripe imports) and depends only on its own interfaces (**ports**). Real technology lives in **adapters** that implement those ports and are bound by DI in the module file. Dependencies point inward.

```
payments/
├─ payments.module.ts              # binds ports → adapters via DI providers
├─ payments.public.ts              # exported facade (inbound use-cases + shared types)
├─ domain/                         # PURE. no Nest, no Prisma, no Stripe.
│  ├─ ledger/                      # transaction/entry entities; invariant: debits === credits
│  ├─ earnings/                    # earnings-calculator: fixed-per-item | views×rate, budget-capped
│  ├─ payout/                      # hold-vs-release decision rules
│  ├─ money.vo.ts                  # minor units + ISO currency; never floats
│  └─ ports/
│     ├─ inbound/                  # use-case interfaces the core offers
│     │  ├─ fund-campaign.usecase.ts
│     │  ├─ record-earning.usecase.ts
│     │  └─ request-withdrawal.usecase.ts
│     └─ outbound/                 # interfaces the core needs (no impls here)
│        ├─ ledger.repository.ts
│        ├─ payment-gateway.port.ts   # createCheckout / createPayout / placeHold
│        ├─ event-publisher.port.ts
│        └─ clock.port.ts
├─ application/                    # inbound use-case impls: orchestrate domain + ports
│  ├─ fund-campaign.service.ts
│  ├─ record-earning.service.ts
│  └─ request-withdrawal.service.ts
├─ infrastructure/                 # ADAPTERS — the only place tech names appear
│  ├─ persistence/prisma-ledger.repository.ts   # implements ledger.repository.ts
│  ├─ stripe/stripe-payment-gateway.ts          # implements payment-gateway.port.ts
│  └─ outbox/outbox-event-publisher.ts          # implements event-publisher.port.ts
├─ controllers/                    # driving adapter: HTTP → inbound use-cases
└─ jobs/                           # driving adapter: BullMQ → inbound use-cases
```

The DI binding in `payments.module.ts` is what makes the adapter swappable:
```ts
providers: [
  FundCampaignService,
  { provide: 'PaymentGatewayPort', useClass: StripePaymentGateway },
  { provide: 'LedgerRepository',   useClass: PrismaLedgerRepository },
];
```

**`fraud`** uses the same shape, and its payoff is the contract's data-gated timeline (§1.8/1.9): a single `risk-model.port.ts` has a `RulesBasedRiskModel` adapter bound **at launch** and an `MlRiskModel` adapter bound **~3 months post-launch** when operational data exists — flip one DI binding, nothing else changes.

```
fraud/
├─ fraud.module.ts
├─ fraud.public.ts
├─ domain/
│  ├─ rules/                       # velocity, repeat-viewer, engagement-pod heuristics
│  ├─ risk-score.vo.ts
│  └─ ports/
│     ├─ inbound/score-submission.usecase.ts
│     └─ outbound/
│        ├─ signal-source.port.ts
│        ├─ risk-model.port.ts      # score(features) -> RiskScore
│        └─ risk-repository.port.ts
├─ application/score-submission.service.ts
├─ infrastructure/
│  ├─ signals/social-signal-source.ts
│  ├─ model/rules-based-risk-model.ts    # bound at LAUNCH
│  └─ model/ml-risk-model.ts             # bound POST-LAUNCH (same port)
└─ jobs/score-submission.processor.ts
```

**Why only these two:** `payments` must have its money rules unit-tested with zero infrastructure, must be able to swap the payment provider (contract §2 force-majeure), and must quarantine PCI/SDK sprawl; `fraud` must swap rules→ML behind one interface. No other module has all — or any — of those pressures, so they stay flat.

---

## 6. Data model & database strategy

- **One database, one Prisma schema** (physically split into per-module files via Prisma's `prismaSchemaFolder`). Table names are module-prefixed (`campaign_*`, `payment_*`) or grouped under a Postgres `schema` per module for clarity — decision recorded in ADR-0003.
- **Foreign keys across modules are allowed** (e.g. `applications.campaign_id → campaigns.id`). This is a monolith; referential integrity is a feature, not a smell.
- **Access discipline:** a module's Prisma models are only touched by that module's repositories. Cross-module data needs go through the owning service facade.

### Core tables (first pass)

- **iam:** `users`, `organizations`, `teams`, `memberships` (user↔org/team + role), `api_keys`.
- **campaigns:** `campaigns`, `campaign_invitations`, `categories`, `platform_rates`.
- **creators:** `creator_profiles`, `social_accounts`, `verifications`.
- **applications:** `applications`.
- **submissions:** `submissions`, `submission_revisions`, `reviews`.
- **payments (ledger is the crown jewel):**
  - `ledger_accounts` (per org, per creator, plus platform clearing accounts).
  - `ledger_entries` — **append-only, double-entry**: every entry has a paired debit/credit, a `transaction_id`, currency (minor units + ISO code), and a reference to the source event. Balances are derived, never mutated in place.
  - `funding` (Stripe Checkout sessions/payment intents), `withdrawals`, `payout_holds`.
  - The ledger is a **reconciliation record, not a bank/escrow** (contract §1.5) — it mirrors Stripe truth and holds no funds.
- **billing:** `subscriptions`, `plans`.
- **social:** `oauth_tokens` (encrypted), `metric_snapshots` (append-only time-series rows).
- **media:** `media_assets`, `clips`.
- **fraud:** `risk_signals`, `risk_scores`, `fraud_cases`.
- **notifications:** `notifications`, `notification_prefs`.
- **disputes:** `disputes`, `dispute_events`.
- **platform:** `outbox`, `audit_log`, `idempotency_keys`.

### Earnings calculation
Single shared domain service in `payments/domain`: `computeEarnings({ method, approvedItems | reportedViews, rate, budgetCap })` implementing the contract's two methods (fixed-per-approved-item **or** views × agreed rate), always clamped to the campaign budget cap (§1.5). Amounts are integers in minor units; currency is explicit; never floats.

---

## 7. Eventing, jobs & reliability

- **In-process events** (`platform/events`): a service emits `SubmissionApproved`; interested modules subscribe synchronously for cheap in-transaction reactions.
- **Transactional outbox** (`platform/outbox`): for side effects that must not be lost (payout initiation, notifications, metric ingestion follow-ups), the service writes an `outbox` row in the same transaction as the state change. A poller (in the worker) reads unsent rows and enqueues BullMQ jobs, marking them sent. Idempotent consumers + `idempotency_keys` make retries safe.
- **BullMQ queues** (examples): `payments.payout`, `notifications.dispatch`, `social.poll`, `media.process`, `fraud.score`, `reports.generate`, `ai.generate`.
- **Scheduled jobs:** social metric polling (per connected account), nightly Stripe⇄ledger reconciliation, dispute SLA timers, report cleanup.
- **Webhooks** (`src/webhooks`): verify signature → persist raw event → enqueue → return 200 immediately. Processing happens in the worker so a slow downstream never blocks the provider callback.

---

## 8. API, auth & security

- **REST**, versioned under `/v1`, resource-oriented, cursor-paginated. **OpenAPI** generated from decorators + Zod DTOs; `openapi.json` committed and consumed by the web/mobile client-SDK generators.
- **Auth:** in-house. Registration/login issues a short-lived **JWT access token** + a **rotating refresh token** (persisted in `refresh_tokens`, revocable — enabling logout and "sign out everywhere"). A global `JwtAuthGuard` verifies the access token and resolves an internal **principal** (user, org, roles, scopes). Passwords hashed with **argon2**; email verification + password reset flows included. Social login (Google/Apple) via Passport OAuth strategies; enterprise **SAML/OIDC** (§1.7) added later via `passport-saml`/`openid-client`, mapping the external identity to the same principal. Mobile stores tokens in secure storage (Keychain/Keystore).
- **RBAC:** roles `brand_owner`, `brand_member`, `creator`, `admin` (+ finer org/team roles). `@RequirePermission('payout:approve')` on controllers; a `PolicyGuard` also enforces **resource ownership / tenancy** (an org can only see its own campaigns; a creator only their own earnings — §1.5 role-based visibility).
- **API keys** for the public/open API (§1.7): scoped, hashed at rest, rate-limited per key.
- **Security controls:** Redis-backed rate limiting, request idempotency on money endpoints, input validation at every edge, secrets via env/secret manager, encrypted OAuth tokens (KMS envelope), Helmet + strict CORS, full **audit log** on all financial and admin mutations, PCI scope confined to Stripe.

---

## 9. External integrations (adapters in `infrastructure/`)

| Provider | Module | Use |
|---|---|---|
| — (auth is in-house) | iam | No external auth provider; social login uses Google/Apple OAuth, enterprise SSO via SAML/OIDC (added later) |
| Stripe | payments, billing, creators | Checkout funding, Connect payouts + holds, Billing subscriptions, Identity KYC, Tax |
| Social APIs (TikTok/IG/YouTube) | social | OAuth connect, scheduled metric polling → snapshots |
| Mux (+ S3/R2) | media | Upload, transcode, clip generation, playback (§1.11) |
| Anthropic Claude | ai | Brief drafting, content ideas, coaching, ad-disclosure checks |
| Resend / FCM / APNs | notifications | Email + push dispatch |

Each integration is a single adapter behind a module-owned port interface, so a provider swap or the contract's §2 force-majeure fallback touches one file.

---

## 10. Fraud & AI posture (data-gated per contract)

- **Launch:** deterministic **rules engine** in `fraud` (velocity, repeat-viewer/bot heuristics, engagement-pod clustering). Drives **risk-based payout timing** via the payout job.
- **AI assistants:** live from launch through the `ai` module (Claude) — briefs, ideas, coaching, disclosure checks.
- **Predictive/ML (§1.9) & AI matching (§1.7):** deferred per the contract's post-launch data start-condition. The `social.metric_snapshots`, `fraud.risk_signals`, and audit history captured from day one **are** the training corpus. When the gate opens, model serving is added behind the existing `fraud`/`ai` facades — no schema rewrite required.

---

## 11. Delivery phases (maps to contract milestones M1/M2/M3)

**Phase 0 — Foundation (repo + platform kernel)**
Repo scaffold, NestJS app + worker entrypoints, Prisma + Postgres + first migration, in-house auth (register/login, argon2, JWT + refresh rotation, JwtAuthGuard) + RBAC, config/logging/OpenAPI/health, Docker Compose local infra, CI pipeline, outbox + BullMQ wiring.

**Phase 1 — Core revenue loop → M2**
`iam` (orgs/teams/roles) → `campaigns` (CRUD, publish, invite) → `creators` (profile, verify, social connect) → `applications` → `submissions` (upload/link + review workflow) → `payments` (ledger + Stripe Checkout funding + Connect onboarding) → `notifications` (baseline). This is the ≥50% milestone shared with web + both mobile apps.

**Phase 2 — Full contracted scope → M3**
`social` metric ingestion + dashboards; `analytics` reports (§1.2); withdrawals + admin payout review/holds; `billing` tiers; i18n-ready content + multi-currency in ledger; `fraud` rules + risk-based payout timing; `media` clipping pipeline (§1.11); public API + API keys + SSO; `disputes` center (§1.10); `admin` console API; hardening + QA window.

**Phase 3 — Data-gated (post-launch)**
Predictive AI (§1.9), AI creator matching + live budget reallocation (§1.7), ML fraud scoring (§1.8) — added behind existing module facades once operational data exists.

---

## 12. Future extraction points (documented, not built)

The monolith is designed so that *if* a context ever needs independent scaling, it can be lifted out with minimal churn:
- Module facades (`*.public.ts`) are the only cross-module surface → they become network APIs.
- Outbox + BullMQ can be repointed to a broker (e.g. Kafka) without changing producers.
- `social` (high-volume polling) and `media` (CPU-heavy) are the most likely first extractions; `payments` stays central for transactional integrity.

**None of this is implemented now.** It is captured only so today's boundaries stay honest.

---

## 13. Local development & CI

- **Local:** `docker-compose.dev.yml` runs Postgres + Redis; `pnpm dev` runs API + worker with hot reload; `pnpm prisma migrate dev` for schema; `pnpm seed` for data.
- **CI (GitHub Actions):** install → lint (incl. module-boundary rule) → typecheck → unit tests → integration tests (Testcontainers) → build → `prisma migrate diff` drift check → export & diff `openapi.json`.
- **Environments:** dev, staging, production; migrations run as a gated deploy step; secrets from the platform secret manager.

---

## 14. First implementation steps (Phase 0 checklist)

1. `pnpm init`, install NestJS 11, Prisma, Zod, BullMQ, Passport (`passport-jwt`), `argon2`, Stripe SDK; strict `tsconfig`.
2. Scaffold `platform/` kernel (config, database, auth, rbac, events, outbox, queue, http, observability, openapi).
3. Add `main.ts` (API) and `worker.ts` (worker) entrypoints sharing `app.module.ts`.
4. Prisma datasource + `prismaSchemaFolder`; create `iam` models; first migration.
5. In-house auth: register/login endpoints, argon2 hashing, JWT + rotating refresh tokens, `JwtAuthGuard` + `@CurrentUser` + RBAC scaffolding.
6. Outbox table + poller + one demo queue to prove the reliability path end-to-end.
7. Docker Compose (Postgres + Redis), `.env.example`, health check, `/metrics`.
8. CI pipeline green (lint + typecheck + test + migrate-check + openapi export).
9. ADRs: ADR-0001 modular monolith, ADR-0002 single DB + ownership rule, ADR-0003 schema/table naming, ADR-0004 outbox over Kafka, ADR-0005 flat module layout by default with hexagonal reserved for `payments` & `fraud`.

---

*This plan intentionally trades theoretical scale for delivery speed and operational simplicity, while keeping bounded-context discipline so the system can grow into separate services only if and when real load requires it.*
