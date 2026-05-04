# WatchMe V2 Boundary Audit

Date: 2026-05-04

## Summary

The workspace now has a clearer four-project split, but the Lite backend/runtime is still the main remaining cleanup item.

## Pro V2

Root: `C:\Users\yid19\OneDrive\Desktop\WatchMe project\pro.v2`

Should own:
- Pro API.
- Pro worker.
- Pro Discord bot.
- Pro database.
- Pro OAuth/socials/post builder/automation data.
- Data source of truth for `webpage.v2` and `watchme-android`.

Boundary fixes made:
- Removed `LITE_API_WRITE_TOKEN` from Pro production validation.
- Removed `LITE_API_WRITE_TOKEN` from Pro `.env.example`.
- Removed Lite route tests from the default Pro `npm test` command.
- Moved Lite compatibility tests under `npm run test:legacy-lite`.
- Removed `smoke:lite` scripts from the Pro package scripts.
- Removed Pro-token fallback for Lite Discord delivery helpers in the Pro worker.

Still present as legacy compatibility:
- `apps/api/src/lite.js`
- Lite route handlers in `apps/api/src/server.js`
- `syncLitePlatformSubscriptions(...)` in `apps/api/src/queries.js`
- `scripts/lite-pipeline-check.js`
- `tests/lite-routes.test.js`
- `tests/lite-subscriptions.test.js`

These should be moved into `lite.v2` before Pro V2 can be called fully clean.

## Lite V2

Root: `C:\Users\yid19\OneDrive\Desktop\WatchMe project\lite.v2`

Should own:
- Lite Discord client.
- Lite API/runtime.
- Lite database.
- Lite workers.
- Lite env.

Boundary fixes made:
- `src/config.js` now requires explicit `LITE_DISCORD_TOKEN`.
- `src/config.js` now requires explicit `LITE_API_WRITE_TOKEN`.
- `src/config.js` now exposes `LITE_DATABASE_URL`.
- Default Lite API URL is now `http://127.0.0.1:3201`, not Pro's `3101`.
- `.env.example`, README, and cutover preflight tests now use explicit `LITE_*` values.

Still to do:
- Build/move a Lite-owned API/runtime into `lite.v2`.
- Move Lite database tables to a Lite database.
- Move Lite worker/subscription logic out of Pro.
- Update backend stress harness so it no longer launches `pro.v2/scripts/lite-pipeline-check.js`.

## Webpage V2

Root: `C:\Users\yid19\OneDrive\Desktop\WatchMe project\webpage.v2`

Audit result:
- Uses `WEB_V2_PRO_V2_API_BASE_URL`.
- Uses `WEB_V2_PRO_V2_API_TOKEN`.
- Pro data calls go through `apps/api/src/pro-v2-client.js`.
- No separate database ownership found in the quick audit.

Keep it this way: web is a UI/proxy, Pro V2 is the data source.

## Android

Root: `C:\Users\yid19\OneDrive\Desktop\WatchMe project\watchme-android`

Audit note:
- The root contains many screenshots/dumps/build artifacts.
- The app should keep only source/assets/config required for Android.
- `google-services.json`, keystores, local properties, generated builds, and screenshots should not be included in handoff zips unless intentionally needed.

Still to do:
- Add/confirm a clean `.gitignore` that excludes local build output, screenshots, dumps, keystores, and local Firebase config.
- Keep all Pro product data coming from `pro.v2` APIs.

