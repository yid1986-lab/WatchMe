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

function buildGuildId(prefix, index) {
  return `${prefix}-g${String(index + 1).padStart(4, "0")}`;
}

function buildDiscordChannelId(index) {
  return `lite-live-channel-${String(index + 1).padStart(4, "0")}`;
}

function buildLiteCreatorHandle(runId, index) {
  return `watchme-lite-${String(runId || "").toLowerCase()}-${String(index + 1).padStart(2, "0")}`;
}

function buildYouTubeChannelId(runId) {
  const raw = String(runId || "").replace(/[^A-Z0-9_-]/gi, "").toUpperCase();
  return `UC${(raw + "LITECONFIDENCEXXXXXXXXXXXXXXXX").slice(0, 22)}`;
}

function buildVideoId(index) {
  return `v${String(index).padStart(10, "0")}`.slice(0, 11);
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

function buildAtomEntry(channelId, videoId, index) {
  const publishedAt = new Date(Date.UTC(2026, 3, 8, 9, index, 0)).toISOString();
  const updatedAt = new Date(Date.UTC(2026, 3, 8, 9, index, 30)).toISOString();
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
    <title>Lite confidence stream ${index + 1}</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=${videoId}" />
    <author>
      <name>WatchMe Lite</name>
      <uri>https://www.youtube.com/channel/${channelId}</uri>
    </author>
    <published>${publishedAt}</published>
    <updated>${updatedAt}</updated>
  </entry>
</feed>`;
}

function buildYouTubeVideoItem(channelId, videoId, index) {
  return {
    id: videoId,
    snippet: {
      channelId,
      channelTitle: "WatchMe Lite",
      title: `Lite confidence stream ${index + 1}`,
      liveBroadcastContent: "live",
      thumbnails: {
        high: {
          url: `https://images.example/${encodeURIComponent(videoId)}.jpg`,
        },
      },
    },
    liveStreamingDetails: {
      actualStartTime: new Date(Date.UTC(2026, 3, 8, 9, index, 0)).toISOString(),
    },
  };
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
      state.hubSubscribeCalls.push(rawBody.toString("utf8"));
      return sendJson(res, 202, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/youtube/v3/channels") {
      const handle = String(url.searchParams.get("forHandle") || "").trim().toLowerCase();
      const username = String(url.searchParams.get("forUsername") || "").trim().toLowerCase();
      const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
      const key = handle || username || query;
      state.youtubeChannelLookups.push(key);
      const channelId = state.channelIdByLookup.get(key) || null;
      return sendJson(res, 200, {
        items: channelId ? [{ id: channelId }] : [],
      });
    }

    if (req.method === "GET" && url.pathname === "/youtube/v3/videos") {
      const videoId = String(url.searchParams.get("id") || "").trim();
      state.videoLookups.push(videoId);
      const item = state.videoItems.get(videoId) || null;
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

async function waitForWorkerHealth(port) {
  await waitFor(async () => {
    try {
      const result = await requestJson(`http://127.0.0.1:${port}/health`);
      return result?.ok === true;
    } catch {
      return false;
    }
  }, 10000, "worker health");
}

async function waitForLiteCanonicalSubscriptions({ guildIds, canonicalTopicKey, query, timeoutMs }) {
  await waitFor(async () => {
    const result = await query(
      `
        SELECT COUNT(*)::int AS total
        FROM platform_subscriptions
        WHERE guild_id = ANY($1::text[])
          AND platform = 'youtube'
          AND topic_key = $2
          AND status = 'active'
          AND COALESCE(metadata_json->>'scope', '') = 'lite'
      `,
      [guildIds, canonicalTopicKey]
    );

    return Number(result.rows[0]?.total || 0) >= guildIds.length;
  }, timeoutMs, `${guildIds.length} canonical Lite YouTube subscriptions`);
}

async function waitForPostedLiveAlerts({ guildIds, query, expectedCount, timeoutMs }) {
  await waitFor(async () => {
    const result = await query(
      `
        SELECT COUNT(*)::int AS total
        FROM post_history
        WHERE guild_id = ANY($1::text[])
          AND platform = 'youtube'
          AND status = 'posted'
          AND session_key LIKE 'youtube:%'
      `,
      [guildIds]
    );

    return Number(result.rows[0]?.total || 0) >= expectedCount;
  }, timeoutMs, `${expectedCount} delivered Lite YouTube posts`);
}

async function cleanupRun({
  guildIds,
  sourceKeys,
  videoIds,
  workerName,
  query,
  withTransaction,
}) {
  await withTransaction(async (client) => {
    await client.query(
      `
        DELETE FROM job_queue
        WHERE (payload_json->>'guildId') = ANY($1::text[])
           OR (payload_json->>'sourceKey') = ANY($2::text[])
           OR (payload_json->>'topicKey') = ANY($2::text[])
      `,
      [guildIds, sourceKeys]
    );

    await client.query(
      `
        DELETE FROM event_ingest
        WHERE source_key = ANY($1::text[])
           OR source_external_id = ANY($2::text[])
      `,
      [sourceKeys, videoIds]
    );

    await client.query(
      `
        DELETE FROM post_history
        WHERE guild_id = ANY($1::text[])
          AND platform = 'youtube'
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
        DELETE FROM lite_creators
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

    if (workerName) {
      await client.query(
        `
          DELETE FROM worker_heartbeats
          WHERE worker_name = $1
        `,
        [workerName]
      );
    }
  });
}

async function seedLiteGuild({
  apiPort,
  guildId,
  liveChannelId,
  creatorUrl,
  creatorDisplayName,
  addedByDiscordUserId,
}) {
  const channelResponse = await requestJson(`http://127.0.0.1:${apiPort}/api/lite/guilds/${encodeURIComponent(guildId)}/channel`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      announce_channel_id: liveChannelId,
    }),
  });

  const creatorResponse = await requestJson(`http://127.0.0.1:${apiPort}/api/lite/guilds/${encodeURIComponent(guildId)}/creators`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      platform: "youtube",
      display_name: creatorDisplayName,
      url: creatorUrl,
      added_by_discord_user_id: addedByDiscordUserId,
    }),
  });

  const creators = await requestJson(`http://127.0.0.1:${apiPort}/api/lite/guilds/${encodeURIComponent(guildId)}/creators`);

  return {
    channelResponse,
    creatorResponse,
    creators,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = String(args.mode || "smoke").trim().toLowerCase();
  const guildCount = getNumberArg(args, "guilds", mode === "batch" ? 25 : 1);
  const eventCount = getNumberArg(args, "events", 1);
  const timeoutMs = getNumberArg(args, "timeoutMs", mode === "batch" ? 180000 : 120000);
  const apiPort = getNumberArg(args, "apiPort", 39261);
  const workerPort = getNumberArg(args, "workerPort", 39262);
  const stubPort = getNumberArg(args, "stubPort", 39491);
  const runId = buildRunId();
  const guildPrefix = `lite-${mode}-${runId.toLowerCase()}`;
  const guildIds = Array.from({ length: guildCount }, (_, index) => buildGuildId(guildPrefix, index));
  const liveChannelIds = Array.from({ length: guildCount }, (_, index) => buildDiscordChannelId(index));
  const creatorHandle = buildLiteCreatorHandle(runId, 1);
  const creatorUrl = `https://www.youtube.com/@${creatorHandle}`;
  const canonicalChannelId = buildYouTubeChannelId(runId);
  const canonicalSourceKey = `youtube:${canonicalChannelId}`;
  const initialSourceKey = `youtube:${creatorUrl.toLowerCase()}`;
  const videoIds = Array.from({ length: eventCount }, (_, index) => buildVideoId(index + 1));
  const expectedPosts = guildCount * eventCount;
  const startedAt = Date.now();
  const workerBaseUrl = `http://127.0.0.1:${workerPort}`;
  const stubBaseUrl = `http://127.0.0.1:${stubPort}`;
  const internalToken = `lite-proof-${runId.toLowerCase()}`;

  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://watchme:watchme@127.0.0.1:5432/watchme_v2";
  process.env.INTERNAL_API_TOKEN = internalToken;
  process.env.WORKER_NAME = `watchme-v2-lite-${mode}-${runId.toLowerCase()}`;
  process.env.WORKER_PORT = String(workerPort);
  process.env.WORKER_QUEUES = "platform_subscription,platform_ingest,live_post";
  process.env.WORKER_POLL_INTERVAL_MS = "50";
  process.env.WORKER_BATCH_SIZE = String(Math.min(250, Math.max(10, guildCount)));
  process.env.WORKER_CONCURRENCY = String(Math.min(16, Math.max(4, Math.ceil(guildCount / 5))));
  process.env.DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "test-lite-bot-token";
  process.env.DISCORD_API_BASE_URL = `${stubBaseUrl}/discord/api/v10`;
  process.env.YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "test-lite-youtube-key";
  process.env.YOUTUBE_API_BASE_URL = `${stubBaseUrl}/youtube/v3`;
  process.env.YOUTUBE_WEBHOOK_BASE_URL = workerBaseUrl;
  process.env.YOUTUBE_WEBHOOK_HUB_URL = `${stubBaseUrl}/hub/subscribe`;
  process.env.YOUTUBE_WEBHOOK_PATH = "/webhooks/youtube";
  process.env.YOUTUBE_WEBHOOK_LEASE_SECONDS = "864000";

  const state = {
    hubSubscribeCalls: [],
    youtubeChannelLookups: [],
    videoLookups: [],
    discordMessages: [],
    deletedMessages: [],
    videoItems: new Map(),
    channelIdByLookup: new Map([
      [creatorHandle.toLowerCase(), canonicalChannelId],
      [`@${creatorHandle}`.toLowerCase(), canonicalChannelId],
      [creatorUrl.toLowerCase(), canonicalChannelId],
      [canonicalChannelId.toLowerCase(), canonicalChannelId],
    ]),
  };

  for (let index = 0; index < videoIds.length; index += 1) {
    const videoId = videoIds[index];
    state.videoItems.set(videoId, buildYouTubeVideoItem(canonicalChannelId, videoId, index));
  }

  let apiServer = null;
  let stubServer = null;
  let query = null;
  let withTransaction = null;
  let closeApiPool = async () => {};
  let closeWorkerPool = async () => {};
  let startRunner = () => {};
  let stopRunner = () => {};
  let startServer = () => {};
  let stopServer = () => {};

  try {
    ({
      createServer,
    } = require("../apps/api/src/server"));
    ({
      closePool: closeApiPool,
    } = require("../apps/api/src/db"));
    ({
      closePool: closeWorkerPool,
      query,
      withTransaction,
    } = require("../apps/worker/src/db"));
    ({
      startRunner,
      stopRunner,
    } = require("../apps/worker/src/runner"));
    ({
      startServer,
      stopServer,
    } = require("../apps/worker/src/server"));

    try {
      await query("SELECT 1");
    } catch (error) {
      if (String(error?.message || "").includes("ECONNREFUSED")) {
        throw new Error(
          `Database connection failed for ${process.env.DATABASE_URL || "DATABASE_URL"}. ` +
          "Start a local Postgres instance for watchme-v2 before running the Lite proof."
        );
      }
      throw error;
    }

    stubServer = await startStubServer(stubPort, state);
    apiServer = createServer();
    await new Promise((resolve, reject) => {
      apiServer.once("error", reject);
      apiServer.listen(apiPort, "127.0.0.1", resolve);
    });

    startServer();
    await waitForWorkerHealth(workerPort);
    startRunner();

    await cleanupRun({
      guildIds,
      sourceKeys: [initialSourceKey, canonicalSourceKey],
      videoIds,
      workerName: process.env.WORKER_NAME,
      query,
      withTransaction,
    });

    const seedResults = [];
    for (let index = 0; index < guildIds.length; index += 1) {
      seedResults.push(
        await seedLiteGuild({
          apiPort,
          guildId: guildIds[index],
          liveChannelId: liveChannelIds[index],
          creatorUrl,
          creatorDisplayName: "WatchMe Lite",
          addedByDiscordUserId: `lite-user-${runId.toLowerCase()}`,
        })
      );
    }

    if (
      !seedResults.every((result, index) => {
        return (
          result?.channelResponse?.ok === true &&
          result?.channelResponse?.config?.live_channel_id === liveChannelIds[index] &&
          result?.creatorResponse?.ok === true &&
          result?.creators?.ok === true &&
          Number(result?.creators?.capacity?.creatorCount || 0) === 1 &&
          Array.isArray(result?.creators?.creators) &&
          result.creators.creators.length === 1
        );
      })
    ) {
      throw new Error("Lite creator seeding did not complete successfully.");
    }

    await waitFor(() => state.hubSubscribeCalls.length >= 1, timeoutMs, "Lite hub renewal");
    await waitForLiteCanonicalSubscriptions({
      guildIds,
      canonicalTopicKey: canonicalSourceKey,
      query,
      timeoutMs,
    });

    const runtime = await requestJson(`http://127.0.0.1:${workerPort}/ops/runtime`, {
      headers: {
        "x-internal-token": internalToken,
      },
    });

    if (!runtime?.ok) {
      throw new Error("Worker runtime endpoint did not respond with ok.");
    }

    for (let index = 0; index < eventCount; index += 1) {
      const videoId = videoIds[index];
      const response = await requestJson(`http://127.0.0.1:${workerPort}/webhooks/youtube`, {
        method: "POST",
        headers: {
          "Content-Type": "application/atom+xml",
        },
        body: buildAtomEntry(canonicalChannelId, videoId, index),
      });

      if (!response?.ok) {
        throw new Error(`Worker did not accept YouTube event ${videoId}`);
      }
    }

    await waitForPostedLiveAlerts({
      guildIds,
      query,
      expectedCount: expectedPosts,
      timeoutMs,
    });

    await waitFor(() => state.discordMessages.length >= expectedPosts, timeoutMs, `${expectedPosts} Discord Lite deliveries`);

    if (state.discordMessages.length !== expectedPosts) {
      throw new Error(`Expected ${expectedPosts} Discord Lite deliveries but found ${state.discordMessages.length}.`);
    }

    const [postedResult, failedJobsResult, failedPostsResult, finalRuntimeResult] = await Promise.all([
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
              OR (payload_json->>'sourceKey') = ANY($2::text[])
              OR (payload_json->>'topicKey') = ANY($2::text[])
            )
        `,
        [guildIds, [initialSourceKey, canonicalSourceKey]]
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
      requestJson(`http://127.0.0.1:${workerPort}/ops/runtime`, {
        headers: {
          "x-internal-token": internalToken,
        },
      }),
    ]);

    const posted = Number(postedResult.rows[0]?.total || 0);
    const failedJobs = Number(failedJobsResult.rows[0]?.total || 0);
    const failedPosts = Number(failedPostsResult.rows[0]?.total || 0);
    const elapsedMs = Date.now() - startedAt;
    const runtimeFailures = Number(finalRuntimeResult?.runtime?.totalJobsFailed || 0);
    const runtimeRecentFailures = Array.isArray(finalRuntimeResult?.runtime?.recentFailures)
      ? finalRuntimeResult.runtime.recentFailures.length
      : 0;
    const runtimeLastError = String(finalRuntimeResult?.runtime?.lastError || "").trim();

    if (state.hubSubscribeCalls.length < 1) {
      throw new Error("Lite proof did not trigger any YouTube hub renewal.");
    }

    if (posted !== expectedPosts) {
      throw new Error(`Expected ${expectedPosts} posted Lite alerts but found ${posted}.`);
    }

    if (failedJobs > 0 || failedPosts > 0) {
      throw new Error(`Lite proof recorded failed work (failedJobs=${failedJobs}, failedPosts=${failedPosts}).`);
    }

    if (runtimeFailures > 0 || runtimeRecentFailures > 0 || runtimeLastError) {
      throw new Error(
        `Lite proof observed worker runtime failures ` +
        `(totalJobsFailed=${runtimeFailures}, recentFailures=${runtimeRecentFailures}, lastError=${runtimeLastError || "none"}).`
      );
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
      runtimeFailures,
      hubSubscribeCalls: state.hubSubscribeCalls.length,
      youtubeLookups: state.youtubeChannelLookups.length,
      videoLookups: state.videoLookups.length,
      discordMessages: state.discordMessages.length,
      workerRuntime: finalRuntimeResult?.runtime || runtime?.runtime || null,
      elapsedMs,
      deliveriesPerSecond: Number((posted / Math.max(1, elapsedMs / 1000)).toFixed(2)),
      runId,
      canonicalTopicKey: canonicalSourceKey,
    }, null, 2));
  } finally {
    stopRunner();
    stopServer();

    if (apiServer) {
      await new Promise((resolve) => apiServer.close(resolve));
    }

    if (stubServer) {
      await new Promise((resolve) => stubServer.close(resolve));
    }

    if (query && withTransaction) {
      try {
        await cleanupRun({
          guildIds,
          sourceKeys: [initialSourceKey, canonicalSourceKey],
          videoIds,
          workerName: process.env.WORKER_NAME,
          query,
          withTransaction,
        });
      } catch {
        // Best-effort cleanup only for local Lite proof ids.
      }
    }

    await closeApiPool().catch(() => null);
    await closeWorkerPool().catch(() => null);
  }
}

let createServer;

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
