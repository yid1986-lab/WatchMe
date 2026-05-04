---
name: AI task
about: Focused WatchMe task for Cursor, Perplexity, Codex, or another AI agent
title: "[project]: "
labels: ai-task
assignees: ""
---

## Scope

Project root:

- [ ] `WatchMe project/pro.v2`
- [ ] `WatchMe project/lite.v2`
- [ ] `WatchMe project/webpage.v2`
- [ ] `WatchMe project/watchme-android`

## Goal

Describe the single outcome this task should deliver.

## Boundaries

- Do not touch Lite when working on Pro unless explicitly stated.
- Do not touch Pro when working on Lite unless explicitly stated.
- Do not use V1/reference/staging code as an active write target.
- Do not commit secrets, Firebase configs, keystores, APKs, deploy bundles, database files, or dependency folders.

## Acceptance Criteria

- [ ] Code is changed only inside the declared project root.
- [ ] App/web/API behavior is described in the PR.
- [ ] Tests/checks are listed with pass/fail results.
- [ ] Any missing environment/config requirement is documented.

