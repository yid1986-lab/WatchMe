# WatchMe Master Manual Outline

This outline is the starting structure for one shared manual covering:

- `pro.v2`
- `lite.v2`
- `watchme-android`
- `webpage watchme`

It is intentionally product-facing and operator-aware. It should not duplicate deep engineering notes already living inside root-specific docs unless the material is needed for setup, troubleshooting, or launch operations.

## 1. Manual Purpose

The manual should explain:

- what WatchMe is
- which product surface each user should use
- how setup and day-to-day operation work today
- what is production-ready, limited, or preview-only
- how to troubleshoot common failures before escalating to code-level docs

## 2. Audience Tracks

Write the manual for four audiences:

1. Public website visitors evaluating WatchMe
2. Discord server admins setting up Lite or Pro-style flows
3. Creators using the Android/mobile experience
4. Operators maintaining the backend, website, and deployment environment

Keep these audiences clearly separated so the reader is never forced to parse irrelevant instructions.

## 3. Proposed Chapter Structure

### Chapter 1: WatchMe Overview

- Product family map
- Difference between website, Lite V2, Pro V2, and Android app
- Current launch status and important limitations

### Chapter 2: Accounts, Access, and Auth

- Discord login basics
- Session and token expectations
- Admin permissions vs creator permissions
- Known auth limitations and fallback behaviors

### Chapter 3: Website and Dashboard Guide

- Logging in through the website
- Billing and subscription entry points
- Guild/dashboard navigation
- Creator and channel management flows
- Known website limitations

### Chapter 4: Lite V2 Discord Bot Guide

- What Lite V2 is for
- `/wme` panel walkthrough
- Setting alert channels
- Adding and removing creators
- Testing alert setup
- Permission model and current limits
- Cutover notes for replacing Lite V1

### Chapter 5: Android App Guide

- Sign-in and account linking
- Profile and live-status features
- Post builder and automation views
- Push notifications and monitoring modes
- Current preview-only or pre-launch limitations

### Chapter 6: Pro V2 Runtime Guide

- What Pro V2 owns in the system
- API, worker, pager, and database roles
- Health endpoints and operational concepts
- Webhook and connector prerequisites
- Backup and recovery basics

### Chapter 7: Troubleshooting

- Website login failures
- Missing dashboard data
- Lite V2 panel failures
- Android auth or push issues
- Backend health and queue warnings
- When to use local checks vs SSH/server checks

### Chapter 8: Launch and Rollback Checklists

- Pre-launch checklist
- Lite cutover checklist
- Website environment checklist
- Pro V2 deployment checklist
- Rollback triggers and rollback order

## 4. Source Documents To Pull From

### `pro.v2`

- `pro.v2/README.md`
- `pro.v2/docs/pro-v2-build-checkpoint.md`
- `pro.v2/docs/validation-and-soak.md`
- `pro.v2/docs/vps-deploy.md`

### `lite.v2`

- `lite.v2/README.md`
- `lite.v2/docs/lite-cutover-checklist.md`
- `lite.v2/docs/lite-v2-backend-contract.md`

### `watchme-android`

- `watchme-android/app/src/main/java/com/watchme/app/WatchMeApi.kt`
- `watchme-android/app/src/main/java/com/watchme/app/WatchMeAppUi.kt`
- `watchme-android/app/src/main/AndroidManifest.xml`
- `watchme-android/app/build.gradle.kts`

### `webpage watchme`

- `webpage watchme/README.md`
- `webpage watchme/server.js`
- `webpage watchme/routes/auth-routes.js`
- `webpage watchme/routes/dashboard-routes.js`
- `webpage watchme/routes/billing-routes.js`
- `webpage watchme/deploy/DISCORD-OAUTH-TROUBLESHOOTING.md`

## 5. Writing Rules

- Keep end-user steps short and procedural.
- Mark preview-only, internal-only, and operator-only behavior clearly.
- Do not describe features as live unless they are confirmed in the current audited build.
- Avoid mixing website and `webpage.v2` material in this manual.
- Treat `pro.v2` as the backend source of truth for Lite V2 and Android-connected flows.
- Link to deeper engineering docs instead of copying large technical sections.

## 6. Immediate Documentation Backlog

1. Draft the product-family overview and glossary.
2. Draft the website login, billing, and dashboard guide.
3. Draft the Lite V2 `/wme` setup and troubleshooting section.
4. Draft the Android login, profile, and post-builder section.
5. Draft the Pro V2 operator section for health, backup, pager, and env setup.
6. Add one consolidated launch checklist that references the per-product rollout notes.

## 7. Open Items Before Full Manual Drafting

- Confirm exact deployed host topology over SSH
- Confirm which website/dashboard actions are truly live versus preview-only
- Confirm Android production auth, push, and release-signing readiness
- Confirm Lite V2 production permission language and cutover timing
- Confirm token and secret split strategy on the shared host
