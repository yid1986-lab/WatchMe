# Migration Plan

## Phase 1
- scaffold V2 services and shared package
- create Postgres schema
- move dashboard config reads and writes to Postgres
- mirror current guild and creator data into V2 manually for testing
- lock Lite and Pro access rules before importing old assumptions

## Phase 2
- move Discord login and billing checks into V2 API
- implement worker-owned post history and live session dedupe
- implement Twitch and YouTube ingestion in V2

## Phase 3
- run V2 in parallel on a test domain
- connect test guilds only
- validate creator management, posting, and multi-guild isolation

## Phase 4
- migrate selected real guilds from current Pro to V2
- keep Lite isolated until Pro is stable
- plan Lite V2 only after Pro V2 has proven stable

## Locked access rules
- Lite stays Discord-first and capped at 5 creators per server
- Pro is server-bound, not just user-bound
- only admins/mods of the bound Pro server can use the website UI
- regular users submit creator details in Discord, not in the website UI

## Current pain points V2 is meant to remove
- route mismatch bugs between frontend and backend
- SQLite state spread across processes
- polling and posting living in the same runtime as dashboard logic
- fragile platform connectors causing noisy cross-platform failures
- difficult scaling past small test groups
