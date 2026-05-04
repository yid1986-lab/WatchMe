# WatchMe Web V2

WatchMe Web V2 is the clean rebuild track for the public website, Discord login flow, billing entitlement checks, and the creator automation dashboard shell.

## Why This Exists

The current live website has drifted into a mixed shape:

- one live VPS copy
- one cleaner local source tree
- frontend and backend concerns still too tightly coupled
- deploy mistakes can take down routing or grant the wrong entitlement

V2 starts as a separate project so we can harden it without touching the live site.

## Principles

- keep website V2 separate from the current live website
- split API and web app paths clearly
- never treat pending checkout as paid Pro access
- Discord login must use the app first, then browser fallback
- make deploy paths obvious and easy to validate
- keep cutover reversible

## Project Layout

- `apps/api`: Express API shell for auth, entitlement, billing, and health
- `apps/web`: React + Vite shell for the public site and dashboard entry
- `docs`: V2 architecture and cutover notes
- `tests`: starter smoke tests

## Local Start

1. Copy `.env.example` to `.env`.
2. Fill in values as needed.
3. Run `npm install`.
4. Run `npm run dev`.

API defaults to `http://127.0.0.1:3102`.
Web defaults to `http://127.0.0.1:5174`.

## Current Scope

This scaffold is the start of the safer rebuild, not the final product. The current focus is creator automation inside Discord communities, not broad platform sprawl. It gives us:

- a clean folder boundary
- explicit entitlement rules
- a health endpoint
- a V2 landing shell for creator automation
- a first live-automation dashboard surface for filters, routing, follow-ups, and creator performance
- a written plan for the next steps
