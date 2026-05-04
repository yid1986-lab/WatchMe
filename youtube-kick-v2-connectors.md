# Mobile App Plan

## Short answer

Yes. WatchMe can support phone-first streaming moments.

## What has to happen

### Best version for V2
- creators still go live in the platform's own mobile app
- WatchMe detects the live event from the platform account or channel
- WatchMe posts to Discord and future socials from the backend worker
- admins and creators manage setup from the WatchMe mobile app

This works well for:
- "I am live from my phone right now"
- "I am at an event and cannot open a PC"
- quick setup or quick changes before going live

## Why this is the right first mobile product

Platform detection should stay server-side.

That means the app does not care whether the stream started from:
- a PC
- a console
- a phone
- a mobile camera workflow in Kick/Facebook/Twitch/YouTube

What matters is:
- the creator's platform account is connected
- the worker has ingestion for that platform
- dedupe and posting are reliable

## Current codebase signal

The old web app already shows this shape:
- creator profile fields for Twitch, YouTube, and Kick
- worker/API direction for platform subscription renewal in V2
- Facebook social connection routes in V1

## Product boundary

There are two very different ideas:

### A. Detect platform lives and share them
This should be a WatchMe feature.
This is the right path now.

### B. WatchMe becomes the streaming camera app
This would require:
- native camera capture
- stream encoding
- RTMP or platform-native SDK support
- background behavior handling
- much larger App Store review and support surface

That is possible later, but it should not block the first mobile app.

## Recommended build order

1. Make `apps/web` the single dashboard UI for V2.
2. Keep platform detection in `apps/worker`.
3. Add a Capacitor shell in `apps/mobile`.
4. Focus first on creator/admin setup and live status screens.
5. Add push notifications later for "you went live" and "post sent" confirmations.
