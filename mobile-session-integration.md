# WatchMe V2 Architecture

## Service split

### `apps/api`
- Discord login and session handling
- billing state and plan lookup
- dashboard reads and writes
- creator approval and configuration endpoints
- webhook registration APIs if needed

### `apps/worker`
- Twitch EventSub ingestion
- YouTube feed/webhook ingestion
- Kick polling or webhook handling behind a guarded connector
- dedupe checks
- post fan-out to Discord and future social connectors
- queue consumers and retry logic
- entitlement enforcement before Pro-only work is dispatched
- global provider dedupe so one tracked source can fan out to many guilds

### `apps/web`
- frontend app only
- no platform polling
- no direct writes to SQLite or process-owned state

### `apps/mobile`
- creator-facing mobile app
- Discord login
- global creator profile editing
- personal stream links and post templates
- mobile shell for iOS and Android
- reuses the V2 web UI where practical
- handles app-level concerns like deep links, push, and platform packaging
- does not own live polling or post fan-out
- request activation in a server, rather than re-entering data each time

## Product access model

### Lite
- supports Twitch and YouTube
- no welcome message spam
- no website UI for regular users
- server setup stays admin/mod controlled
- hard cap of 5 creators per server total
- when the cap is reached, WatchMe shows an upgrade prompt and link to Pro

### Pro
- one Pro purchase creates one server entitlement
- the entitlement binds to one guild when the single-use Pro install is confirmed
- entitlement status must support:
  - `active`
  - `grace_period`
  - `inactive`
  - `manual_test`
  - `manual_free`
- only admins/mods of the bound guild can access the website UI
- regular users do not use the website UI
- creators store their profile globally by Discord user ID
- creators can request activation in a guild through Discord or mobile
- admins/mods approve or disable creator access per guild
- when Pro becomes inactive, the guild falls back to Lite-safe behavior rather than losing the bot install
- Pro-only jobs and routes must be blocked by entitlement state before expensive provider work runs

### Website UI
- admin/mod only
- server config
- creator approvals
- branding
- channel settings
- platform connections
- social grab settings
- live builder and test-post controls

### Discord user flow
- creator can request usage of their saved WatchMe profile in a guild
- guild approval remains per server
- this keeps creator identity global and server activation local

## Data model direction

Postgres becomes the source of truth for:
- users
- guilds
- pro_entitlements
- guild_admin_access
- creator_identities
- guild_creator_activations
- guild_memberships
- subscriptions
- guild_config
- creator_profiles
- creator_access
- social_post_publications
- platform_connections
- event_subscriptions
- live_sessions
- post_history
- audit_logs

## 1000-server framework

V2 should be comfortable at roughly 1000 servers without another rewrite by following these rules:
- web never runs polling loops
- workers claim jobs from durable tables instead of keeping state in memory
- platform subscriptions are tracked once per unique source where possible
- one source event can fan out to many guilds
- entitlement checks happen before expensive provider or posting work
- worker retries are bounded and observable
- every connector can be paused without taking the rest of the product down
- provider dedupe keys are global, while posting history is per guild
- queue depth, lock age, retry count, and provider failure rate are first-class operational signals
- webhook renewals, polling sweeps, live-post fan-out, and social-post fan-out stay in separate queues
- outbound social publications and inbound social grabs must share origin receipts so WatchMe never re-ingests its own posts
- Facebook and Instagram are separate connectors even though both are Meta-owned
- no single guild should be able to monopolize worker capacity
- all Pro-only fan-out should degrade to Lite-safe behavior instead of silently failing open

## Operational guardrails

- Pro-only jobs should be blocked for `inactive` entitlements
- `grace_period` should warn but not hard-cut immediately
- test/free guilds should be explicit entitlement states, not hidden exceptions
- provider tokens, webhook leases, and queue lag need visible operational status
- queue depth, retry counts, and provider error rates should be measurable before public scale pushes

## Why this is better

- restarts do not lose or corrupt shared state
- web and worker deploys are independent
- a broken platform integration does not poison the whole product
- scaling to many guilds is mostly a worker and queue problem, not a single-process problem
- migrations become explicit and reviewable

## Non-goals for V2 phase 1

- replacing the live product immediately
- building every platform at once
- supporting every old edge case before the foundation is sound
