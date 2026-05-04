{
  "name": "pro.v2",
  "private": true,
  "version": "0.1.0",
  "engines": {
    "node": ">=20.0.0"
  },
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev:api": "node apps/api/src/index.js",
    "dev:worker": "node apps/worker/src/index.js",
    "dev:stack": "node scripts/run-ops-stack.js",
    "soak:stack": "node scripts/soak-ops-stack.js",
    "soak:stack:1h": "node scripts/soak-ops-stack.js --durationSec=3600",
    "dev:pager": "node scripts/ops-pager-loop.js",
    "pager:once": "node scripts/ops-pager-loop.js --once=true",
    "check": "node apps/api/src/index.js --check && node apps/worker/src/index.js --check",
    "test": "node tests/shared-pipeline.test.js && node tests/mobile-auth.test.js && node tests/lite-subscriptions.test.js && node tests/lite-routes.test.js && node tests/social-adapters.test.js && node tests/facebook-worker.test.js && node tests/instagram-worker.test.js && node tests/worker-runtime.test.js && node tests/live-automation.test.js && node tests/youtube-worker.test.js && node tests/kick-worker.test.js && node tests/subscription-renewal.test.js && node tests/twitch-subscriptions.test.js && node tests/runner-concurrency.test.js && node tests/ops-runtime.test.js && node tests/paging-policy.test.js && node tests/pg-utils.test.js && node tests/discord-rate-limit.test.js",
    "pg:backup": "node scripts/pg-backup.js",
    "pg:restore-drill": "node scripts/pg-restore-drill.js",
    "discord:guild-snapshot": "node scripts/discord-guild-snapshot.js",
    "report:guild-creators": "node scripts/guild-creator-report.js",
    "smoke:facebook-social": "node scripts/facebook-social-check.js",
    "smoke:instagram-inbound": "node scripts/instagram-inbound-check.js",
    "smoke:paging": "node scripts/paging-check.js",
    "smoke:worker-heartbeat": "node scripts/worker-heartbeat-check.js",
    "smoke:social-feed": "node scripts/social-feed-check.js",
    "stress:social-feed": "node scripts/social-feed-stress.js --guilds=1000 --events=3",
    "smoke:instagram-social": "node scripts/instagram-social-check.js",
    "smoke:social-ingest": "node scripts/social-ingest-check.js",
    "smoke:social-loop": "node scripts/social-loop-check.js",
    "smoke:social-origin": "node scripts/social-origin-check.js",
    "smoke:lite": "node scripts/lite-pipeline-check.js --mode=smoke",
    "smoke:lite:batch": "node scripts/lite-pipeline-check.js --mode=batch --guilds=25 --events=1",
    "smoke:twitch": "node scripts/twitch-pipeline-check.js --mode=smoke",
    "stress:twitch": "node scripts/twitch-pipeline-check.js --mode=stress --guilds=1000 --events=3",
    "smoke:multi-worker": "node scripts/multi-worker-check.js --mode=smoke",
    "stress:multi-worker": "node scripts/multi-worker-check.js --mode=stress --guilds=1000 --events=2 --workers=2",
    "stress:multi-worker:4": "node scripts/multi-worker-check.js --mode=stress --guilds=1000 --events=2 --workers=4",
    "soak:multi-worker": "node scripts/multi-worker-check.js --mode=soak --guilds=400 --workers=4 --durationSec=45 --batchIntervalMs=250",
    "smoke:youtube": "node scripts/youtube-pipeline-check.js --mode=smoke",
    "stress:youtube": "node scripts/youtube-pipeline-check.js --mode=stress --guilds=1000 --events=3",
    "smoke:kick": "node scripts/kick-pipeline-check.js --mode=smoke",
    "stress:kick": "node scripts/kick-pipeline-check.js --mode=stress --guilds=1000 --events=3"
  }
}
