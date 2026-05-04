const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

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
  return `mw-channel-${String(index + 1).padStart(4, "0")}`;
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
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

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

async function countPostedAlerts(query, guildIds) {
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

  return Number(result.rows[0]?.total || 0);
}

async function countFailedJobs(query, guildIds, sourceKey) {
  const result = await query(
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
  );

  return Number(result.rows[0]?.total || 0);
}

async function countFailedPosts(query, guildIds) {
  const result = await query(
    `
      SELECT COUNT(*)::int AS total
      FROM post_history
      WHERE guild_id = ANY($1::text[])
        AND platform = 'youtube'
        AND status = 'failed'
    `,
    [guildIds]
  );

  return Number(result.rows[0]?.total || 0);
}

async function waitForPostedAlerts(query, guildIds, expectedCount, timeoutMs, label = null) {
  await waitFor(async () => {
    return (await countPostedAlerts(query, guildIds)) >= expectedCount;
  }, timeoutMs, label || `${expectedCount} delivered multi-worker posts`);
}

async function waitForQueueDrain(query, guildIds, sourceKey, timeoutMs) {
  await waitFor(async () => {
    const result = await query(
      `
        SELECT COUNT(*)::int AS total
        FROM job_queue
        WHERE status IN ('pending', 'processing')
          AND (
            (payload_json->>'guildId') = ANY($1::text[])
            OR (payload_json->>'sourceKey') = $2
            OR (payload_json->>'topicKey') = $2
          )
      `,
      [guildIds, sourceKey]
    );

    return Number(result.rows[0]?.total || 0) === 0;
  }, timeoutMs, "queue drain");
}

async function collectWorkerRuntimeMetrics(workers = []) {
  const snapshots = [];

  for (const worker of workers) {
    if (!worker?.child || worker.child.exitCode !== null) {
      continue;
    }

    try {
      const runtime = await getWorkerRuntime(worker);
      if (runtime?.runtime) {
        snapshots.push({
          workerName: worker.workerName,
          port: worker.port,
          runtime: runtime.runtime,
        });
      }
    } catch {
      // Best-effort runtime sampling only for soak visibility.
    }
  }

  return {
    activeWorkerCount: snapshots.length,
    maxRssBytes: snapshots.reduce((max, item) => Math.max(max, Number(item.runtime?.process?.maxRssBytes || 0)), 0),
    maxHeapUsedBytes: snapshots.reduce((max, item) => Math.max(max, Number(item.runtime?.process?.maxHeapUsedBytes || 0)), 0),
    totalStaleLocksReleased: snapshots.reduce((sum, item) => sum + Number(item.runtime?.totalStaleLocksReleased || 0), 0),
    maxLastTickDurationMs: snapshots.reduce((max, item) => Math.max(max, Number(item.runtime?.lastTickDurationMs || 0)), 0),
    snapshots,
  };
}

function buildYouTubeVideoItem(channelId, videoId, index) {
  const startedAt = new Date(Date.UTC(2026, 3, 3, 12, index, 0)).toISOString();
  return {
    id: videoId,
    snippet: {
      channelId,
      channelTitle: "WatchMe Multi-Worker Channel",
      title: `Multi-worker live ${index + 1}`,
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
  const publishedAt = new Date(Date.UTC(2026, 3, 3, 12, index, 0)).toISOString();
  const updatedAt = new Date(Date.UTC(2026, 3, 3, 12, index, 30)).toISOString();
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
    <title>Multi-worker live ${index + 1}</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=${videoId}" />
    <author>
      <name>WatchMe Multi-Worker Channel</name>
      <uri>https://www.youtube.com/channel/${channelId}</uri>
    </author>
    <published>${publishedAt}</published>
    <updated>${updatedAt}</updated>
  </entry>
</feed>`;
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
    if (req.method === "GET" && channelMessageMatch) {
      const channelId = decodeURIComponent(channelMessageMatch[1]);
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 25)));
      const messages = state.discordMessages
        .filter((item) => item.channelId === channelId)
        .slice(-limit)
        .reverse()
        .map((item) => ({
          id: item.id,
          ...(item.payload || {}),
        }));

      return sendJson(res, 200, messages);
    }

    if (req.method === "POST" && channelMessageMatch) {
      const rawBody = await readRawBody(req);
      let payload = {};
      try {
        payload = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
      } catch {
        payload = {};
      }

      if (state.discordDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.discordDelayMs));
      }

      state.discordMessages.push({
        id: `message-${state.discordMessages.length + 1}`,
        channelId: decodeURIComponent(channelMessageMatch[1]),
        payload,
      });

      return sendJson(res, 200, {
        id: state.discordMessages[state.discordMessages.length - 1].id,
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

function createLogBuffer(limit = 200) {
  const lines = [];
  return {
    push(chunk) {
      const next = String(chunk || "")
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean);
      lines.push(...next);
      if (lines.length > limit) {
        lines.splice(0, lines.length - limit);
      }
    },
    read() {
      return [...lines];
    },
  };
}

function spawnWorker({ cwd, workerName, port, webhookBaseUrl, stubBaseUrl, batchSize, concurrency, lockTimeoutSeconds }) {
  const stdout = createLogBuffer();
  const stderr = createLogBuffer();
  const child = spawn(
    process.execPath,
    [path.join("apps", "worker", "src", "index.js")],
    {
      cwd,
      env: {
        ...process.env,
        NODE_ENV: "test",
        WORKER_NAME: workerName,
        WORKER_PORT: String(port),
        WORKER_POLL_INTERVAL_MS: "50",
        WORKER_BATCH_SIZE: String(batchSize),
        WORKER_CONCURRENCY: String(concurrency),
        WORKER_LOCK_TIMEOUT_SECONDS: String(lockTimeoutSeconds),
        WORKER_QUEUES: "platform_ingest,platform_subscription,live_post",
        DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || "test-bot-token",
        DISCORD_API_BASE_URL: `${stubBaseUrl}/discord/api/v10`,
        YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY || "test-youtube-key",
        YOUTUBE_API_BASE_URL: `${stubBaseUrl}/youtube/v3`,
        YOUTUBE_WEBHOOK_BASE_URL: webhookBaseUrl,
        YOUTUBE_WEBHOOK_HUB_URL: `${stubBaseUrl}/hub/subscribe`,
        YOUTUBE_WEBHOOK_PATH: "/webhooks/youtube",
        YOUTUBE_WEBHOOK_LEASE_SECONDS: "864000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));

  return {
    child,
    workerName,
    port,
    stdout,
    stderr,
  };
}

async function waitForWorkerHealth(worker, timeoutMs) {
  await waitFor(async () => {
    try {
      const health = await requestJson(`http://127.0.0.1:${worker.port}/health`);
      return health?.ok === true;
    } catch {
      return false;
    }
  }, timeoutMs, `${worker.workerName} health`);
}

async function getWorkerRuntime(worker) {
  return requestJson(`http://127.0.0.1:${worker.port}/ops/runtime`);
}

async function stopWorkerGracefully(worker) {
  if (!worker?.child || worker.child.exitCode !== null) {
    return;
  }

  worker.child.kill("SIGTERM");
  const exited = await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000);
    worker.child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

  if (!exited && worker.child.exitCode === null) {
    await killWorkerForce(worker);
  }
}

async function killWorkerForce(worker) {
  if (!worker?.child || worker.child.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(worker.child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
      killer.once("exit", resolve);
      killer.once("error", resolve);
    });
    return;
  }

  worker.child.kill("SIGKILL");
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000);
    worker.child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
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
        [guildId, `Multi-worker Guild ${index + 1}`]
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
          "WatchMe Multi-worker",
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
  const isSoakMode = mode === "soak";
  const guildCount = getNumberArg(args, "guilds", mode === "stress" ? 1000 : isSoakMode ? 400 : 200);
  const eventCount = getNumberArg(args, "events", isSoakMode ? 999999 : 2);
  const workerCount = getNumberArg(args, "workers", isSoakMode ? 4 : 2);
  const timeoutMs = getNumberArg(args, "timeoutMs", mode === "stress" ? 300000 : isSoakMode ? 240000 : 180000);
  const workerPortStart = getNumberArg(args, "workerPortStart", 39302);
  const stubPort = getNumberArg(args, "stubPort", 39390);
  const batchSize = getNumberArg(args, "batchSize", isSoakMode ? 50 : 25);
  const concurrency = getNumberArg(args, "concurrency", isSoakMode ? 8 : 4);
  const lockTimeoutSeconds = getNumberArg(args, "lockTimeoutSeconds", 2);
  const discordDelayMs = getNumberArg(args, "discordDelayMs", isSoakMode ? 20 : 150);
  const durationSec = getNumberArg(args, "durationSec", isSoakMode ? 45 : 0);
  const batchIntervalMs = getNumberArg(args, "batchIntervalMs", isSoakMode ? 250 : 0);
  const crashBatchIndex = getNumberArg(args, "crashBatchIndex", isSoakMode ? 1 : 0);
  const runId = buildRunId();
  const channelId = buildChannelId(runId);
  const sourceKey = `youtube:${channelId}`;
  const guildPrefix = `mw-${mode}-${runId.toLowerCase()}`;
  const guildIds = Array.from({ length: guildCount }, (_, index) => buildGuildId(guildPrefix, index));
  const primaryWorkerBaseUrl = `http://127.0.0.1:${workerPortStart}`;
  const stubBaseUrl = `http://127.0.0.1:${stubPort}`;
  const workspaceRoot = path.resolve(__dirname, "..");

  const state = {
    subscribeCalls: [],
    videoLookups: [],
    discordMessages: [],
    deletedMessages: [],
    videoItems: new Map(),
    discordDelayMs,
  };

  let stubServer = null;
  let query = null;
  let withTransaction = null;
  let closePool = async () => {};
  let enqueuePlatformSubscriptionRenewalJob = null;
  let buildYouTubeFeedTopic = null;
  const workers = [];
  const startedAt = Date.now();
  let teardownPromise = null;

  const closeStubServer = async () => {
    if (!stubServer) {
      return;
    }

    const server = stubServer;
    stubServer = null;
    await new Promise((resolve) => server.close(resolve));
  };

  const teardown = async () => {
    if (!teardownPromise) {
      teardownPromise = (async () => {
        await Promise.all(workers.map((worker) => stopWorkerGracefully(worker)));
        await closeStubServer().catch(() => null);
        if (query && withTransaction) {
          try {
            await cleanupRun({ guildIds, sourceKey, query, withTransaction });
          } catch {
            // Best-effort cleanup only for local stress ids.
          }
        }
        await closePool().catch(() => null);
      })();
    }

    return teardownPromise;
  };

  const handleSigint = () => {
    void teardown().finally(() => {
      process.exit(1);
    });
  };

  const handleSigterm = () => {
    void teardown().finally(() => {
      process.exit(1);
    });
  };

  process.once("SIGINT", handleSigint);
  process.once("SIGTERM", handleSigterm);

  try {
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

    for (let index = 0; index < workerCount; index += 1) {
      const worker = spawnWorker({
        cwd: workspaceRoot,
        workerName: `watchme-v2-multi-${index + 1}`,
        port: workerPortStart + index,
        webhookBaseUrl: primaryWorkerBaseUrl,
        stubBaseUrl,
        batchSize,
        concurrency,
        lockTimeoutSeconds,
      });
      workers.push(worker);
    }

    await Promise.all(workers.map((worker) => waitForWorkerHealth(worker, timeoutMs)));

    await cleanupRun({ guildIds, sourceKey, query, withTransaction });

    const leader = await seedGuildSubscriptions({
      guildIds,
      sourceKey,
      channelId,
      webhookUrl: `${primaryWorkerBaseUrl}/webhooks/youtube`,
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

    const challenge = `mw-challenge-${runId.toLowerCase()}`;
    const topic = buildYouTubeFeedTopic(channelId);
    const verificationText = await requestText(
      `${primaryWorkerBaseUrl}/webhooks/youtube?hub.mode=subscribe&hub.topic=${encodeURIComponent(topic)}&hub.challenge=${encodeURIComponent(challenge)}&hub.lease_seconds=864000`
    );

    if (verificationText !== challenge) {
      throw new Error("Primary worker did not echo the YouTube hub challenge.");
    }

    const primaryWorker = workers[0];
    if (!workers[1]) {
      throw new Error("Multi-worker check requires at least 2 workers.");
    }

    let crashedWorker = null;
    let survivingWorker = primaryWorker;
    let webhookTargetBaseUrl = primaryWorkerBaseUrl;
    let batchesCompleted = 0;
    let staleLocksExpected = false;
    let crashLockedJobs = 0;
    const soakDeadlineAt = isSoakMode ? Date.now() + durationSec * 1000 : null;
    const runtimeSamples = [];

    while (batchesCompleted < eventCount && (!isSoakMode || Date.now() < soakDeadlineAt)) {
      const batchIndex = batchesCompleted;
      const videoId = buildVideoId(batchIndex + 1);
      state.videoItems.set(videoId, buildYouTubeVideoItem(channelId, videoId, batchIndex));

      const response = await requestJson(`${webhookTargetBaseUrl}/webhooks/youtube`, {
        method: "POST",
        headers: {
          "Content-Type": "application/atom+xml",
        },
        body: buildAtomEntry(channelId, videoId, batchIndex),
      });

      if (!response?.ok) {
        throw new Error(`Primary worker did not accept YouTube event ${videoId}`);
      }

      if (!crashedWorker && batchIndex === crashBatchIndex) {
        let livePostOwner = null;
        await waitFor(async () => {
          const result = await query(
            `
              SELECT locked_by, COUNT(*)::int AS total
              FROM job_queue
              WHERE status = 'processing'
                AND queue_name = 'live_post'
              GROUP BY locked_by
              ORDER BY total DESC, locked_by ASC
            `
          );

          const owner = result.rows.find((row) => {
            return workers.some((worker) => worker.workerName === row.locked_by);
          });

          if (owner?.locked_by) {
            livePostOwner = owner.locked_by;
            return true;
          }

          return false;
        }, timeoutMs, "a worker holding live_post locks");

        crashedWorker = workers.find((worker) => worker.workerName === livePostOwner) || null;
        survivingWorker = workers.find((worker) => worker.workerName !== livePostOwner) || primaryWorker;

        if (!crashedWorker) {
          throw new Error("Could not determine which worker owned the live_post jobs.");
        }

        await killWorkerForce(crashedWorker);
        webhookTargetBaseUrl = `http://127.0.0.1:${survivingWorker.port}`;

        const crashedLockCount = await query(
          `
            SELECT COUNT(*)::int AS total
            FROM job_queue
            WHERE status = 'processing'
              AND queue_name = 'live_post'
              AND locked_by = $1
          `,
          [crashedWorker.workerName]
        );

        crashLockedJobs = Number(crashedLockCount.rows[0]?.total || 0);
        staleLocksExpected = crashLockedJobs > 0;

        if (staleLocksExpected) {
          await waitFor(async () => {
            for (const worker of workers) {
              if (!worker || worker === crashedWorker || worker.child.exitCode !== null) {
                continue;
              }

              try {
                const runtime = await getWorkerRuntime(worker);
                if (Number(runtime?.runtime?.totalStaleLocksReleased || 0) > 0) {
                  return true;
                }
              } catch {
                // Ignore transient runtime probe failures while the remaining workers settle.
              }
            }

            return false;
          }, timeoutMs, "stale lock recovery on an active worker");
        }
      }

      const expectedSoFar = guildCount * (batchIndex + 1);
      await waitForPostedAlerts(query, guildIds, expectedSoFar, timeoutMs, `${expectedSoFar} delivered multi-worker posts`);
      batchesCompleted += 1;

      if (isSoakMode) {
        runtimeSamples.push({
          batch: batchesCompleted,
          at: new Date().toISOString(),
          ...(await collectWorkerRuntimeMetrics(workers)),
        });

        if (batchIntervalMs > 0 && Date.now() < soakDeadlineAt) {
          await sleep(batchIntervalMs);
        }
      }
    }

    if (batchesCompleted <= 0) {
      throw new Error("Soak run did not complete any event batches before the deadline.");
    }

    const expectedPosts = guildCount * batchesCompleted;
    await waitForQueueDrain(query, guildIds, sourceKey, timeoutMs);

    const [posted, failedJobs, failedPosts, finalRuntimeMetrics] = await Promise.all([
      countPostedAlerts(query, guildIds),
      countFailedJobs(query, guildIds, sourceKey),
      countFailedPosts(query, guildIds),
      collectWorkerRuntimeMetrics(workers),
    ]);

    const staleLocksReleased = Number(finalRuntimeMetrics.totalStaleLocksReleased || 0);
    const elapsedMs = Date.now() - startedAt;

    if (posted !== expectedPosts) {
      throw new Error(`Expected ${expectedPosts} posted alerts but found ${posted}.`);
    }

    if (failedJobs > 0 || failedPosts > 0) {
      throw new Error(`Multi-worker run recorded failed work (failedJobs=${failedJobs}, failedPosts=${failedPosts}).`);
    }

    if (crashedWorker && staleLocksExpected && staleLocksReleased <= 0) {
      throw new Error("Expected the surviving worker to release at least one stale lock after the crash.");
    }

    console.log(JSON.stringify({
      ok: true,
      mode,
      guildCount,
      eventCount,
      workerCount,
      expectedPosts,
      posted,
      failedJobs,
      failedPosts,
      staleLocksReleased,
      staleLocksExpected,
      crashLockedJobs,
      batchesCompleted,
      renewCalls: state.subscribeCalls.length,
      youtubeLookups: state.videoLookups.length,
      discordMessages: state.discordMessages.length,
      maxRssBytes: Number(finalRuntimeMetrics.maxRssBytes || 0),
      maxHeapUsedBytes: Number(finalRuntimeMetrics.maxHeapUsedBytes || 0),
      maxLastTickDurationMs: Number(finalRuntimeMetrics.maxLastTickDurationMs || 0),
      runtimeSampleCount: runtimeSamples.length,
      elapsedMs,
      deliveriesPerSecond: Number((posted / Math.max(1, elapsedMs / 1000)).toFixed(2)),
      crashedWorker: crashedWorker?.workerName || null,
      survivingWorker: survivingWorker?.workerName || null,
      runId,
    }, null, 2));
  } catch (error) {
    const workerLogs = workers.map((worker) => ({
      worker: worker.workerName,
      stdout: worker.stdout.read().slice(-20),
      stderr: worker.stderr.read().slice(-20),
    }));

    console.error(JSON.stringify({
      error: error?.message || String(error),
      workerLogs,
    }, null, 2));
    throw error;
  } finally {
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
    await teardown();
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
