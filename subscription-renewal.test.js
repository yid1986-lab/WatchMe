const http = require("node:http");

function parseArgs(argv) {
  const entries = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [rawKey, ...rawValue] = arg.slice(2).split("=");
    entries[rawKey] = rawValue.length ? rawValue.join("=") : "true";
  }
  return entries;
}

function getNumberArg(args, key, fallback) {
  const value = Number(args[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function buildRunId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

function buildChannelId(runId) {
  const raw = String(runId || "").replace(/[^A-Z0-9_-]/gi, "").toUpperCase();
  const suffix = (raw + "XXXXXXXXXXXXXXXXXXXXXX").slice(0, 22);
  return `UC${suffix}`;
}

function buildVideoId(index) {
  return `v${String(index).padStart(10, "0")}`.slice(0, 11);
}

function buildGuildId(prefix, index) {
  return `${prefix}-g${String(index + 1).padStart(4, "0")}`;
}

function buildChannelName(index) {
  return `channel-${String(index + 1).padStart(4, "0")}`;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function buildYouTubeVideoItem(channelId, videoId, index) {
  const startedAt = new Date(Date.UTC(2026, 3, 2, 10, index, 0)).toISOString();
  return {
    id: videoId,
    snippet: {
      channelId,
      channelTitle: "WatchMe Stress Channel",
      title: `Stress stream ${index + 1}`,
      liveBroadcastContent: "live",
      thumbnails: {
        high: {
          url: `https://images.example/${encodeURIComponent(videoId)}.jpg`,
        },
      },
    },
    liveStreamingDetails: {
      actualStartTime: startedAt,
    },
  };
}

function buildAtomEntry(channelId, videoId, index) {
  const publishedAt = new Date(Date.UTC(2026, 3, 2, 10, index, 0)).toISOString();
  const updatedAt = new Date(Date.UTC(2026, 3, 2, 10, index, 30)).toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <link rel="hub" href="https://pubsubhubbub.appspot.com" />
  <link rel="self" href="https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}" />
  <title>YouTube video feed</title>
  <updated>${updatedAt}</updated>
  <entry>
    <id>yt:video:${videoId}</id>
    <yt:videoId>${videoId}</yt:videoId>
    <yt:channelId>${channelId}</yt:channelId>
    <title>Stress stream ${index + 1}</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=${videoId}" />
    <author>
      <name>WatchMe Stress Channel</name>
      <uri>https://www.youtube.com/channel/${channelId}</uri>
    </author>
    <published>${publishedAt}</published>
    <updated>${updatedAt}</updated>
  </entry>
</feed>`;
}

async function waitFor(check, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForCanonicalSubscriptions({ guildIds, sourceKey, expectedCount, query, timeoutMs }) {
  await waitFor(async () => {
    const result = await query(
      `
        SELECT COUNT(*)::int AS total
        FROM platform_subscriptions
        WHERE guild_id = ANY($1::text[])
          AND platform = 'youtube'
          AND topic_key = $2
          AND status = 'active'
      `,
      [guildIds, sourceKey]
    );

    return Number(result.rows[0]?.total || 0) >= expectedCount;
  }, timeoutMs, `${expectedCount} canonical YouTube subscriptions`);
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: init.signal || AbortSignal.timeout(10000),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!response.ok) {
    throw new Error(data?.message || text || `${response.status} ${response.statusText}`);
  }
  return data;
}

async function requestText(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: init.signal || AbortSignal.timeout(10000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return text;
}

async function startStubServer(port, state) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);

    if (req.method === "POST" && url.pathname === "/hub/subscribe") {
      const rawBody = await readRawBody(req);
      state.subscribeCalls.push(rawBody.toString("utf8"));
      res.writeHead(202, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("accepted");
      return;
    }

    if (req.method === "GET" && url.pathname === "/youtube/v3/videos") {
      const videoId = String(url.searchParams.get("id") || "").trim();
      state.videoLookups.push(videoId);
      const item = state.videoItems.get(videoId);
      return sendJson(res, 200, {
        items: item ? [item] : [],
      });
    }

    const channelMessageMatch = url.pathname.match(/^\/discord\/api\/v10\/channels\/([^/]+)\/messages$/);
    if (req.method === "POST" && channelMessageMatch) {
      const rawBody = await readRawBody(req);
      let payload = {};
      try {
        payload = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
      } catch {
        payload = {};
      }

      state.discordMessages.push({
        channelId: decodeURIComponent(channelMessageMatch[1]),
        payload,
      });

      return sendJson(res, 200, {
        id: `message-${state.discordMessages.length}`,
      });
    }

    const deleteMessageMatch = url.pathname.match(/^\/discord\/api\/v10\/channels\/([^/]+)\/messages\/([^/]+)$/);
    if (req.method === "DELETE" && deleteMessageMatch) {
      state.deletedMessages.push({
        channelId: decodeURIComponent(deleteMessageMatch[1]),
        messageId: decodeURIComponent(deleteMessageMatch[2]),
      });
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { error: "Not found" });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  return server;
}

async function seedGuildSubscriptions({ guildIds, sourceKey, channelId, webhookUrl, runId, query, withTransaction }) {
  await withTransaction(async (client) => {
    for (let index = 0; index < guildIds.length; index += 1) {
      const guildId = guildIds[index];
      const liveChannelId = buildChannelName(index);

      await client.query(
        `
          INSERT INTO guilds (guild_id, name, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (guild_id) DO UPDATE SET
            name = EXCLUDED.name,
            updated_at = NOW()
        `,
        [guildId, `Stress Guild ${index + 1}`]
      );

      await client.query(
        `
          INSERT INTO guild_config (
            guild_id,
            live_channel_id,
            announce_channel_id,
            mention_mode,
            brand_name,
            footer_text,
            guild_youtube_url,
            updated_at
          )
          VALUES ($1, $2, $2, 'role', $3, $4, $5, NOW())
          ON CONFLICT (guild_id) DO UPDATE SET
            live_channel_id = EXCLUDED.live_channel_id,
            announce_channel_id = EXCLUDED.announce_channel_id,
            mention_mode = EXCLUDED.mention_mode,
            brand_name = EXCLUDED.brand_name,
            footer_text = EXCLUDED.footer_text,
            guild_youtube_url = EXCLUDED.guild_youtube_url,
            updated_at = NOW()
        `,
        [
          guildId,
          liveChannelId,
          "WatchMe Stress",
          `Run ${runId}`,
          `https://www.youtube.com/channel/${channelId}`,
        ]
      );

      await client.query(
        `
          INSERT INTO pro_entitlements (
            plan_code,
            status,
            bound_guild_id,
            bound_at,
            updated_at
          )
          VALUES ('pro', 'active', $1, NOW(), NOW())
          ON CONFLICT (bound_guild_id) DO UPDATE SET
            plan_code = 'pro',
            status = 'active',
            bound_at = COALESCE(pro_entitlements.bound_at, NOW()),
            updated_at = NOW()
        `,
        [guildId]
      );

      await client.query(
        `
          INSERT INTO platform_subscriptions (
            guild_id,
            platform,
            topic_key,
            callback_url,
            status,
            metadata_json,
            updated_at
          )
          VALUES ($1, 'youtube', $2, $3, 'active', $4::jsonb, NOW())
          ON CONFLICT (
            platform,
            topic_key,
            guild_id,
            creator_guild_id,
            creator_discord_user_id
          ) DO UPDATE SET
            callback_url = COALESCE(EXCLUDED.callback_url, platform_subscriptions.callback_url),
            status = 'active',
            metadata_json = platform_subscriptions.metadata_json || EXCLUDED.metadata_json,
            updated_at = NOW()
        `,
        [
          guildId,
          sourceKey,
          webhookUrl,
          JSON.stringify({
            scope: "guild",
            sourceUrl: `https://www.youtube.com/channel/${channelId}`,
            channelId,
            runId,
          }),
        ]
      );
    }
  });

  const result = await query(
    `
      SELECT *
      FROM platform_subscriptions
      WHERE platform = 'youtube'
        AND topic_key = $1
      ORDER BY subscription_id ASC
      LIMIT 1
    `,
    [sourceKey]
  );

  return result.rows[0] || null;
}

async function cleanupRun({ guildIds, sourceKey, query, withTransaction }) {
  await withTransaction(async (client) => {
    await client.query(
      `
        DELETE FROM job_queue
        WHERE (payload_json->>'guildId') = ANY($1::text[])
           OR (payload_json->>'sourceKey') = $2
           OR (payload_json->>'topicKey') = $2
      `,
      [guildIds, sourceKey]
    );

    await client.query(
      `
        DELETE FROM event_ingest
        WHERE source_key = $1
      `,
      [sourceKey]
    );

    await client.query(
      `
        DELETE FROM post_history
        WHERE guild_id = ANY($1::text[])
      `,
      [guildIds]
    );

    await client.query(
      `
        DELETE FROM live_sessions
        WHERE guild_id = ANY($1::text[])
      `,
      [guildIds]
    );

    await client.query(
      `
        DELETE FROM platform_subscriptions
        WHERE guild_id = ANY($1::text[])
      `,
      [guildIds]
    );

    await client.query(
      `
        DELETE FROM guild_config
        WHERE guild_id = ANY($1::text[])
      `,
      [guildIds]
    );

    await client.query(
      `
        DELETE FROM pro_entitlements
        WHERE bound_guild_id = ANY($1::text[])
      `,
      [guildIds]
    );

    await client.query(
      `
        DELETE FROM guilds
        WHERE guild_id = ANY($1::text[])
      `,
      [guildIds]
    );
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = String(args.mode || "smoke").trim().toLowerCase();
  const guildCount = getNumberArg(args, "guilds", mode === "stress" ? 1000 : 5);
  const eventCount = getNumberArg(args, "events", mode === "stress" ? 3 : 1);
  const timeoutMs = getNumberArg(args, "timeoutMs", mode === "stress" ? 300000 : 120000);
  const workerPort = getNumberArg(args, "workerPort", 39102);
  const stubPort = getNumberArg(args, "stubPort", 39190);
  const runId = buildRunId();
  const channelId = buildChannelId(runId);
  const sourceKey = `youtube:${channelId}`;
  const guildPrefix = `stress-${mode}-${runId.toLowerCase()}`;
  const guildIds = Array.from({ length: guildCount }, (_, index) => buildGuildId(guildPrefix, index));
  const workerBaseUrl = `http://127.0.0.1:${workerPort}`;
  const stubBaseUrl = `http://127.0.0.1:${stubPort}`;

  process.env.NODE_ENV = "test";
  process.env.WORKER_NAME = `watchme-v2-${mode}-worker`;
  process.env.WORKER_PORT = String(workerPort);
  process.env.WORKER_POLL_INTERVAL_MS = "50";
  process.env.WORKER_BATCH_SIZE = String(Math.min(250, Math.max(25, guildCount)));
  process.env.WORKER_CONCURRENCY = String(Math.min(32, Math.max(4, Math.ceil(guildCount / 50))));
  process.env.DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "test-bot-token";
  process.env.DISCORD_API_BASE_URL = `${stubBaseUrl}/discord/api/v10`;
  process.env.YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "test-youtube-key";
  process.env.YOUTUBE_API_BASE_URL = `${stubBaseUrl}/youtube/v3`;
  process.env.YOUTUBE_WEBHOOK_BASE_URL = workerBaseUrl;
  process.env.YOUTUBE_WEBHOOK_HUB_URL = `${stubBaseUrl}/hub/subscribe`;
  process.env.YOUTUBE_WEBHOOK_PATH = "/webhooks/youtube";
  process.env.YOUTUBE_WEBHOOK_LEASE_SECONDS = "864000";

  const state = {
    subscribeCalls: [],
    videoLookups: [],
    discordMessages: [],
    deletedMessages: [],
    videoItems: new Map(),
  };

  let stubServer = null;
  let query = null;
  let withTransaction = null;
  let closePool = async () => {};
  let enqueuePlatformSubscriptionRenewalJob = null;
  let buildYouTubeFeedTopic = null;
  let startRunner = () => {};
  let stopRunner = () => {};
  let startServer = () => {};
  let stopServer = () => {};
  const startedAt = Date.now();

  try {
    ({
      startRunner,
      stopRunner,
    } = require("../apps/worker/src/runner"));
    ({
      startServer,
      stopServer,
    } = require("../apps/worker/src/server"));
    ({
      closePool,
      query,
      withTransaction,
    } = require("../apps/worker/src/db"));
    ({
      enqueuePlatformSubscriptionRenewalJob,
    } = require("../apps/worker/src/store"));
    ({
      buildYouTubeFeedTopic,
    } = require("../apps/worker/src/youtube"));

    try {
      await query("SELECT 1");
    } catch (error) {
      if (String(error?.message || "").includes("ECONNREFUSED")) {
        throw new Error(
          `Database connection failed for ${process.env.DATABASE_URL || "DATABASE_URL"}. ` +
          "Start a local Postgres instance for watchme-v2 before running smoke or stress checks."
        );
      }
      throw error;
    }
    stubServer = await startStubServer(stubPort, state);
    startServer();
    startRunner();

    await cleanupRun({ guildIds, sourceKey, query, withTransaction });
    const leader = await seedGuildSubscriptions({
      guildIds,
      sourceKey,
      channelId,
      webhookUrl: `${workerBaseUrl}/webhooks/youtube`,
      runId,
      query,
      withTransaction,
    });

    if (!leader?.subscription_id) {
      throw new Error("Failed to seed the leader platform subscription.");
    }

    await enqueuePlatformSubscriptionRenewalJob({
      subscriptionId: leader.subscription_id,
      platform: "youtube",
      topicKey: sourceKey,
      guildId: leader.guild_id,
      scope: "guild",
      metadata: leader.metadata_json || {},
    });

    await waitFor(() => state.subscribeCalls.length >= 1, timeoutMs, "the YouTube renewal job");
    await waitForCanonicalSubscriptions({
      guildIds,
      sourceKey,
      expectedCount: guildCount,
      query,
      timeoutMs,
    });

    const topic = buildYouTubeFeedTopic(channelId);
    const challenge = `challenge-${runId.toLowerCase()}`;
    const verificationText = await requestText(
      `${workerBaseUrl}/webhooks/youtube?hub.mode=subscribe&hub.topic=${encodeURIComponent(topic)}&hub.challenge=${encodeURIComponent(challenge)}&hub.lease_seconds=864000`
    );

    if (verificationText !== challenge) {
      throw new Error("Worker did not echo the YouTube hub challenge.");
    }

    for (let index = 0; index < eventCount; index += 1) {
      const videoId = buildVideoId(index + 1);
      state.videoItems.set(videoId, buildYouTubeVideoItem(channelId, videoId, index));

      const response = await requestJson(`${workerBaseUrl}/webhooks/youtube`, {
        method: "POST",
        headers: {
          "Content-Type": "application/atom+xml",
        },
        body: buildAtomEntry(channelId, videoId, index),
      });

      if (!response?.ok) {
        throw new Error(`Worker did not accept YouTube event ${videoId}`);
      }
    }

    const expectedPosts = guildCount * eventCount;
    await waitFor(async () => {
      const result = await query(
        `
          SELECT COUNT(*)::int AS total
          FROM post_history
          WHERE guild_id = ANY($1::text[])
            AND platform = 'youtube'
            AND status = 'posted'
        `,
        [guildIds]
      );

      return Number(result.rows[0]?.total || 0) >= expectedPosts;
    }, timeoutMs, `${expectedPosts} delivered live posts`);

    const [postedResult, failedJobsResult, failedPostsResult] = await Promise.all([
      query(
        `
          SELECT COUNT(*)::int AS total
          FROM post_history
          WHERE guild_id = ANY($1::text[])
            AND platform = 'youtube'
            AND status = 'posted'
        `,
        [guildIds]
      ),
      query(
        `
          SELECT COUNT(*)::int AS total
          FROM job_queue
          WHERE status = 'failed'
            AND (
              (payload_json->>'guildId') = ANY($1::text[])
              OR (payload_json->>'sourceKey') = $2
              OR (payload_json->>'topicKey') = $2
            )
        `,
        [guildIds, sourceKey]
      ),
      query(
        `
          SELECT COUNT(*)::int AS total
          FROM post_history
          WHERE guild_id = ANY($1::text[])
            AND platform = 'youtube'
            AND status = 'failed'
        `,
        [guildIds]
      ),
    ]);

    const posted = Number(postedResult.rows[0]?.total || 0);
    const failedJobs = Number(failedJobsResult.rows[0]?.total || 0);
    const failedPosts = Number(failedPostsResult.rows[0]?.total || 0);
    const elapsedMs = Date.now() - startedAt;

    if (posted !== expectedPosts) {
      throw new Error(`Expected ${expectedPosts} posted alerts but found ${posted}.`);
    }

    if (failedJobs > 0 || failedPosts > 0) {
      throw new Error(`Smoke run recorded failed work (failedJobs=${failedJobs}, failedPosts=${failedPosts}).`);
    }

    console.log(JSON.stringify({
      ok: true,
      mode,
      guildCount,
      eventCount,
      expectedPosts,
      posted,
      failedJobs,
      failedPosts,
      renewCalls: state.subscribeCalls.length,
      youtubeLookups: state.videoLookups.length,
      discordMessages: state.discordMessages.length,
      elapsedMs,
      deliveriesPerSecond: Number((posted / Math.max(1, elapsedMs / 1000)).toFixed(2)),
      runId,
    }, null, 2));
  } finally {
    stopRunner();
    stopServer();
    if (stubServer) {
      await new Promise((resolve) => stubServer.close(resolve));
    }
    if (query && withTransaction) {
      try {
        await cleanupRun({ guildIds, sourceKey, query, withTransaction });
      } catch {
        // Best-effort cleanup only for local stress ids.
      }
    }
    await closePool().catch(() => null);
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
