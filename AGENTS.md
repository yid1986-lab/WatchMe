# WatchMe Agent Instructions

This repository is intentionally split into four active projects under `WatchMe project/`.

## Required First Read

Before editing, read:

1. `WatchMe project/WORKSPACE-INDEX.md`
2. `WatchMe project/NEXT-CHAT-START-HERE.md`
3. `WatchMe project/_docs/workspace/WATCHME-V2-PROJECT-SPLIT.md`
4. `WatchMe project/_docs/workspace/WATCHME-WORKSPACE-BOUNDARIES.md`

## Active Write Roots

- Pro backend/runtime work: `WatchMe project/pro.v2`
- Lite V2 work: `WatchMe project/lite.v2`
- Next website work: `WatchMe project/webpage.v2`
- Android app work: `WatchMe project/watchme-android`

## Non-Negotiable Boundaries

- Pro V2 is the source of truth for the Android app and `webpage.v2`.
- Lite V2 must remain separate from Pro V2.
- Never copy Lite env values into Pro or Pro env values into Lite.
- Do not introduce fallback token logic between Lite and Pro.
- Do not commit secrets, service account files, keystores, APKs, deploy archives, local database files, or dependency folders.

## PR Rules

- Keep each PR small and tied to one GitHub issue.
- Name the affected project in the PR title, for example `pro.v2: secure admin dashboard routes`.
- Include exact test commands run.
- If a test cannot run because local credentials are missing, say that clearly.

