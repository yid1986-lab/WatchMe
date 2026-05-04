# watchme-android: Match Pro Data And Fix UI Contrast/Layout

## Scope

Write root: `WatchMe project/watchme-android`

## Goal

Make the Android app show the same Pro data as the web dashboard and remove black text/broken narrow layouts.

## Acceptance Criteria

- Config, channels, creators, branding, post builder, and socials all refresh from Pro V2 APIs.
- No fake/local social connection state remains.
- Guild/channel lists are loaded from backend-managed Discord data.
- No black text appears on dark surfaces.
- Bottom navigation labels fit on phone width.
- Creator cards do not squeeze text into single-letter columns.
- Add or update unit/UI checks where practical.

## Checks

```powershell
cd "WatchMe project/watchme-android"
.\gradlew testDebugUnitTest assembleDebug
```

## Boundaries

- Do not edit Pro backend except through a separate `pro.v2` issue/PR.
- Do not commit `google-services.json`, keystores, APKs, or local properties.

