# WatchMe Web V2 Architecture

## Goal

Build a safer website stack that can support large user and subscriber counts without repeating the current V1 drift.

## Core Rules

1. Website V2 must live in its own project folder and deploy path.
2. Entitlement must be driven by a dedicated billing decision path, never by UI state alone.
3. `APPROVAL_PENDING` must never unlock Pro.
4. Discord login must be app first, browser second.
5. Reverse proxy config must be validated before restart.
6. Website deploy and bot deploy must stay separate.

## Planned Structure

### `apps/api`

Owns:

- health
- auth callback handling
- session validation
- entitlement resolution
- billing state reads
- future webhook receivers

Must not own:

- bundled static marketing pages
- giant frontend component files

### `apps/web`

Owns:

- landing page
- billing page
- dashboard shell
- post-login routing
- safe UI for Lite vs Pro pathways
- Discord app-first login handoff

Must not decide:

- whether a user is Pro
- whether a pending payment counts as active

### Entitlement Layer

The entitlement resolver should return a narrow result:

- `tier`
- `active`
- `source`
- `status`
- `reason`

That decision should later come from one service module only, so both API and UI consume the same answer.

## Cutover Rules

Before V2 goes live:

1. proxy config validates cleanly
2. health endpoint passes
3. auth session endpoint passes
4. pending billing does not unlock Pro
5. public login remains Lite unless billing is truly active or user is manually allowed
6. deploy rollback path is written and tested

## Immediate Next Build Steps

1. add a dedicated entitlement service with test coverage
2. add Discord auth route shells
3. add PayPal state adapter shells
4. add durable session store plan
5. add deploy scripts for a separate V2 host path
