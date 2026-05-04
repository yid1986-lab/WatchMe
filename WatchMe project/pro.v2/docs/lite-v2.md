# Lite V2

## Product shape

- Discord-first only
- admin/mod controlled
- no automatic welcome message
- no regular-user website UI
- Twitch and YouTube supported
- maximum of 5 creators per server total

## Control flow

1. admin or moderator opens the Lite control panel in Discord
2. admin adds Twitch or YouTube creator links
3. WatchMe validates supported platforms only
4. if the server already has 5 creators:
   - block the add
   - show Pro upgrade prompt
   - link to Pro login/upgrade page
5. if under the cap:
   - save creator profile
   - show success in Discord
6. admins can remove creators and refresh the panel

## Supported platforms

- Twitch
- YouTube
- Kick is not included in Lite

## Not in Lite

- Facebook
- Instagram
- X
- branding-heavy Pro controls
- unlimited creators
- regular-user website management

## Shelf-ready definition

Lite V2 is considered complete enough to shelf when it has:
- Discord control panel flow
- 5 creator cap enforcement
- upgrade prompt behavior
- Twitch and YouTube event handling
- durable dedupe and post history
- stable multi-guild behavior
