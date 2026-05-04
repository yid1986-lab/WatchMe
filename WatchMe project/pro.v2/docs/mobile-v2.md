# Mobile V2

## Purpose

The mobile app is not an admin dashboard clone.

It is a creator tool that solves:
- saving stream details once
- saving creator post templates once
- avoiding repeated setup across multiple servers

## Core model

1. creator logs in with Discord
2. WatchMe stores the creator profile globally by Discord user ID
3. creator saves Twitch, YouTube, and later other channels once
4. creator saves personal post template details once
5. when the creator joins a server with WatchMe:
   - they request activation in that guild
   - they do not rebuild the profile from scratch
6. server admins/mods approve or deny that guild activation

## Product split

- mobile = creator-facing
- web = admin/server-facing
- Discord bot = server interaction and approval layer

## Why this matters

- creators hate entering the same data repeatedly
- admins still control who becomes active in their community
- the website stays operational and server-focused
- the mobile app becomes a real value product, not just a smaller dashboard
