const crypto = require("node:crypto");
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

function buildBroadcasterId(runId) {
  const digits = String(runId || "").replace(/\D/g, "") || "479277594";
  return (digits + "479277594123").slice(0, 12);
}

function buildLogin(runId) {
  return `watchme_${String(runId || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 18)}`;
}

function buildGuildId(prefix, index) {
  return `${prefix}-g${String(index + 1).padStart(4, "0")}`;
}

function buildChannelName(index) {
  return `twitch-channel-${String(index + 1).padStart(4, "0")}`;
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

function buildTwitchUserPayload(broadcasterId, login) {
  return {
    id: broadcasterId,
    login,
    display_name: login,
    profile_image_url: `https://images.example/${encodeURIComponent(login)}-profile.jpg`,
  };
}

function buildTwitchStreamPayload(broadcasterId, login, index) {
  return {
    id: `stream-${String(index + 1).padStart(4, "0")}`,
    user_id: broadcasterId,
    user_login: login,
    user_name: login,
    title: `Twitch stress stream ${index + 1}`,
    game_name: "WatchMe Testing",
    viewer_count: 50 + index,
    started_at: new Date(Date.UTC(2026, 3, 3, 10, index, 0)).toISOString(),
    thumbnail_url: `https://images.example/${encodeURIComponent(login)}-{width}x{height}-${index + 1}.jpg`,
  };
}

function buildVerificationBody(subscription, challenge) {
  return {
    challenge,
    subscription: {
      id: subscription.id,
      status: subscription.status,
      type: subscription.type,
      version: subscription.version || "1",
      condition: subscription.condition || {},
      transport: subscription.transport || {},
      created_at: subscription.created_at,
    },
  };
}

function buildNotificationBody(subscription, event = {}) {
  return {
    subscription: {
      id: subscription.id,
      status: "enabled",
      type: subscription.type,
      version: subscription.version || "1",
      condition: subscription.condition || {},
      transport: subscription.transport || {},
      created_at: subscription.created_at,
    },
    event,
  };
}

function buildOnlineEvent(stream, login) {
  return {
    broadcaster_user_id: stream.user_id,
    broadcaster_user_login: login,
    broadcaster_user_name: login,
    started_at: stream.started_at,
  };
}

function buildOfflineEvent(broadcasterId, login) {
  return {
    broadcaster_user_id: broadcasterId,
    broadcaster_user_login: login,
    broadcaster_user_name: login,
  };
}

function buildSignedTwitchRequest(secret, messageType, body) {
  const messageId = `twitch-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = new Date().toISOString();
  const rawBody = Buffer.from(JSON.stringify(body));
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(messageId + timestamp);
  hmac.update(rawBody);
  const signature = `sha256=${hmac.digest("hex")}`;

  return {
    headers: {
      "Content-Type": "application/json",
      "Twitch-Eventsub-Message-Id": messageId,
      "Twitch-Eventsub-Message-Timestamp": timestamp,
      "Twitch-Eventsub-Message-Type": messageType,
      "Twitch-Eventsub-Message-Signature": signature,
    },
    body: rawBody.toString("utf8"),
  };
}

async function startStubServer(port, state) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);

    if (req.method === "POST" && url.pathname === "/twitch/oauth2/token") {
      return sendJson(res, 200, {
        access_token: "twitch-stub-token",
        expires_in: 3600,
        token_type: "bearer",
      });
    }

    if (req.method === "GET" && url.pathname === "/twitch/helix/users") {
      const login = String(url.searchParams.get("login") || "").trim().toLowerCase();
      const user = state.usersByLogin.get(login) || null;
      return sendJson(res, 200, {
        data: user ? [user] : [],
      });
    }

    if (req.method === "GET" && url.pathname === "/twitch/helix/streams") {
      const broadcasterId = String(url.searchParams.get("user_id") || "").trim();
      state.streamLookups.push(broadcasterId);
      const stream = state.streams.get(broadcasterId) || null;
      return sendJson(res, 200, {
        data: stream ? [stream] : [],
      });
    }

    if (req.method === "GET" && url.pathname === "/twitch/helix/eventsub/subscriptions") {
      return sendJson(res, 200, {
        data: state.eventSubscriptions,
        pagination: {},
      });
    }

    if (req.method === "POST" && url.pathname === "/twitch/helix/eventsub/subscriptions") {
      const rawBody = await readRawBody(req);
      let payload = {};
      try {
        payload = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
      } catch {
        payload = {};
      }

      const created = {
        id: `eventsub-${state.eventSubscriptions.length + 1}`,
        status: "webhook_callback_verification_pending",
        type: payload.type || "unknown",
        version: payload.version || "1",
        condition: payload.condition || {},
        transport: payload.transport || {},
        created_at: new Date().toISOString(),
      };

      state.eventSubscriptions.push(created);
      state.subscribeCalls.push(created);

      return sendJson(res, 202, {
        data: [created],
      });
    }

    if (req.method === "DELETE" && url.pathname === "/twitch/helix/eventsub/subscriptions") {
      const id = String(url.searchParams.get("id") || "").trim();
      state.eventSubscriptions = state.eventSubscriptions.filter((item) => item.id !== id);
      return sendJson(res, 204, { ok: true });
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

async function seedGuildSubscriptions({
  guildIds,
  initialSourceKey,
  broadcasterId,
  login,
  webhookUrl,
  runId,
  query,
  withTransaction,
}) {
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
        [guildId, `Twitch Stress Guild ${index + 1}`]
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
            auto_cleanup,
            guild_twitch_url,
            updated_at
          )
          VALUES ($1, $2, $2, 'role', $3, $4, TRUE, $5, NOW())
          ON CONFLICT (guild_id) DO UPDATE SET
            live_channel_id = EXCLUDED.live_channel_id,
            announce_channel_id = EXCLUDED.announce_channel_id,
            mention_mode = EXCLUDED.mention_mode,
            brand_name = EXCLUDED.brand_name,
            footer_text = EXCLUDED.footer_text,
            auto_cleanup = EXCLUDED.auto_cleanup,
            guild_twitch_url = EXCLUDED.guild_twitch_url,
            updated_at = NOW()
        `,
        [
          guildId,
          liveChannelId,
          "WatchMe Twitch Stress",
          `Run ${runId}`,
          `https://www.twitch.tv/${login}`,
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
          VALUES ($1, 'twitch', $2, $3, 'active', $4::jsonb, NOW())
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
          initialSourceKey,
          webhookUrl,
          JSON.stringify({
            scope: "guild",
            sourceUrl: `https://www.twitch.tv/${login}`,
            broadcasterId,
            broadcasterLogin: login,
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
      WHERE platform = 'twitch'
        AND guild_id = $1
      ORDER BY subscription_id ASC
      LIMIT 1
    `,
    [guildIds[0]]
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
          AND platform = 'twitch'
          AND topic_key = $2
          AND status = 'active'
      `,
      [guildIds, sourceKey]
    );

    return Number(result.rows[0]?.total || 0) >= expectedCount;
  }, timeoutMs, `${expectedCount} canonical Twitch subscriptions`);
}

async function cleanupRun({ guildIds, sourceKeys, query, withTransaction }) {
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
      `,
      [sourceKeys]
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
  const workerPort = getNumberArg(args, "workerPort", 39002);
  const stubPort = getNumberArg(args, "stubPort", 39090);
  const runId = buildRunId();
  const broadcasterId = buildBroadcasterId(runId);
  const login = buildLogin(runId);
  const initialSourceKey = `twitch:${login}`;
  const canonicalSourceKey = `twitch:${broadcasterId}`;
  const guildPrefix = `stress-twitch-${mode}-${runId.toLowerCase()}`;
  const guildIds = Array.from({ length: guildCount }, (_, index) => buildGuildId(guildPrefix, index));
  const workerBaseUrl = `http://127.0.0.1:${workerPort}`;
  const stubBaseUrl = `http://127.0.0.1:${stubPort}`;
  const twitchSecret = `watchme-twitch-secret-${runId.toLowerCase()}`;

  process.env.NODE_ENV = "test";
  process.env.WORKER_NAME = `watchme-v2-twitch-${mode}-worker`;
  process.env.WORKER_PORT = String(workerPort);
  process.env.WORKER_POLL_INTERVAL_MS = "50";
  process.env.WORKER_BATCH_SIZE = String(Math.min(250, Math.max(25, guildCount)));
  process.env.WORKER_CONCURRENCY = String(Math.min(32, Math.max(4, Math.ceil(guildCount / 50))));
  process.env.DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "test-bot-token";
  process.env.DISCORD_API_BASE_URL = `${stubBaseUrl}/discord/api/v10`;
  process.env.TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || "twitch-stub-client";
  process.env.TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || "twitch-stub-secret";
  process.env.TWITCH_AUTH_URL = `${stubBaseUrl}/twitch/oauth2/token`;
  process.env.TWITCH_API_BASE_URL = `${stubBaseUrl}/twitch/helix`;
  process.env.TWITCH_WEBHOOK_BASE_URL = workerBaseUrl;
  process.env.TWITCH_WEBHOOK_SECRET = twitchSecret;
  process.env.TWITCH_WEBHOOK_PATH = "/webhooks/twitch";

  const state = {
    subscribeCalls: [],
    streamLookups: [],
    eventSubscriptions: [],
    usersByLogin: new Map(),
    streams: new Map(),
    discordMessages: [],
    deletedMessages: [],
  };

  state.usersByLogin.set(login, buildTwitchUserPayload(broadcasterId, login));

  let stubServer = null;
  let query = null;
  let withTransaction = null;
  let closePool = async () => {};
  let enqueuePlatformSubscriptionRenewalJob = null;
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

    await cleanupRun({
      guildIds,
      sourceKeys: [initialSourceKey, canonicalSourceKey],
      query,
      withTransaction,
    });

    const leader = await seedGuildSubscriptions({
      guildIds,
      initialSourceKey,
      broadcasterId,
      login,
      webhookUrl: `${workerBaseUrl}/webhooks/twitch`,
      runId,
      query,
      withTransaction,
    });

    if (!leader?.subscription_id) {
      throw new Error("Failed to seed the leader Twitch subscription.");
    }

    await enqueuePlatformSubscriptionRenewalJob({
      subscriptionId: leader.subscription_id,
      platform: "twitch",
      topicKey: leader.topic_key,
      guildId: leader.guild_id,
      scope: "guild",
      metadata: leader.metadata_json || {},
    });

    await waitFor(() => state.eventSubscriptions.length >= 2, timeoutMs, "the Twitch renewal job");
    await waitForCanonicalSubscriptions({
      guildIds,
      sourceKey: canonicalSourceKey,
      expectedCount: guildCount,
      query,
      timeoutMs,
    });

    for (const subscription of state.eventSubscriptions) {
      const challenge = `challenge-${subscription.type}-${runId.toLowerCase()}`;
      const verificationBody = buildVerificationBody(subscription, challenge);
      const request = buildSignedTwitchRequest(twitchSecret, "webhook_callback_verification", verificationBody);
      const responseText = await requestText(`${workerBaseUrl}/webhooks/twitch`, {
        method: "POST",
        headers: request.headers,
        body: request.body,
      });

      if (responseText !== challenge) {
        throw new Error(`Worker did not echo the Twitch challenge for ${subscription.type}.`);
      }
    }

    const onlineSubscription = state.eventSubscriptions.find((item) => item.type === "stream.online");
    const offlineSubscription = state.eventSubscriptions.find((item) => item.type === "stream.offline");

    if (!onlineSubscription || !offlineSubscription) {
      throw new Error("Twitch renewal did not create both online and offline subscriptions.");
    }

    for (let index = 0; index < eventCount; index += 1) {
      const stream = buildTwitchStreamPayload(broadcasterId, login, index);
      state.streams.set(broadcasterId, stream);
      const request = buildSignedTwitchRequest(
        twitchSecret,
        "notification",
        buildNotificationBody(onlineSubscription, buildOnlineEvent(stream, login))
      );

      const response = await requestJson(`${workerBaseUrl}/webhooks/twitch`, {
        method: "POST",
        headers: request.headers,
        body: request.body,
      });

      if (!response?.ok) {
        throw new Error(`Worker did not accept Twitch stream.online event ${index + 1}`);
      }

      const expectedSoFar = guildCount * (index + 1);
      await waitFor(async () => {
        const result = await query(
          `
            SELECT COUNT(*)::int AS total
            FROM post_history
            WHERE guild_id = ANY($1::text[])
              AND platform = 'twitch'
              AND status = 'posted'
          `,
          [guildIds]
        );

        return Number(result.rows[0]?.total || 0) >= expectedSoFar;
      }, timeoutMs, `${expectedSoFar} delivered Twitch posts`);
    }

    const expectedPosts = guildCount * eventCount;

    if (mode === "smoke") {
      state.streams.delete(broadcasterId);
      const offlineRequest = buildSignedTwitchRequest(
        twitchSecret,
        "notification",
        buildNotificationBody(offlineSubscription, buildOfflineEvent(broadcasterId, login))
      );

      const offlineResponse = await requestJson(`${workerBaseUrl}/webhooks/twitch`, {
        method: "POST",
        headers: offlineRequest.headers,
        body: offlineRequest.body,
      });

      if (!offlineResponse?.ok) {
        throw new Error("Worker did not accept the Twitch stream.offline event.");
      }

      await waitFor(async () => {
        const cleared = await query(
          `
            SELECT COUNT(*)::int AS total
            FROM post_history
            WHERE guild_id = ANY($1::text[])
              AND platform = 'twitch'
              AND status = 'cleared'
          `,
          [guildIds]
        );

        return Number(cleared.rows[0]?.total || 0) >= guildCount;
      }, timeoutMs, `${guildCount} cleared Twitch posts`);

      await waitFor(() => state.deletedMessages.length >= guildCount, timeoutMs, `${guildCount} Twitch cleanup deletes`);
    }

    const [postedResult, clearedResult, failedJobsResult, failedPostsResult] = await Promise.all([
      query(
        `
          SELECT COUNT(*)::int AS total
          FROM post_history
          WHERE guild_id = ANY($1::text[])
            AND platform = 'twitch'
            AND status = 'posted'
        `,
        [guildIds]
      ),
      query(
        `
          SELECT COUNT(*)::int AS total
          FROM post_history
          WHERE guild_id = ANY($1::text[])
            AND platform = 'twitch'
            AND status = 'cleared'
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
            AND platform = 'twitch'
            AND status = 'failed'
        `,
        [guildIds]
      ),
    ]);

    const posted = Number(postedResult.rows[0]?.total || 0);
    const cleared = Number(clearedResult.rows[0]?.total || 0);
    const failedJobs = Number(failedJobsResult.rows[0]?.total || 0);
    const failedPosts = Number(failedPostsResult.rows[0]?.total || 0);
    const elapsedMs = Date.now() - startedAt;

    const delivered = mode === "smoke" ? posted + cleared : posted;
    if (delivered !== expectedPosts) {
      throw new Error(`Expected ${expectedPosts} delivered alerts but found ${delivered}.`);
    }

    if (failedJobs > 0 || failedPosts > 0) {
      throw new Error(`Twitch run recorded failed work (failedJobs=${failedJobs}, failedPosts=${failedPosts}).`);
    }

    const deliveredForRate = mode === "smoke" ? posted + cleared : posted;
    console.log(JSON.stringify({
      ok: true,
      mode,
      guildCount,
      eventCount,
      expectedPosts,
      posted,
      cleared,
      failedJobs,
      failedPosts,
      renewCalls: state.subscribeCalls.length,
      eventSubscriptions: state.eventSubscriptions.length,
      streamLookups: state.streamLookups.length,
      discordMessages: state.discordMessages.length,
      deletedMessages: state.deletedMessages.length,
      elapsedMs,
      deliveriesPerSecond: Number((deliveredForRate / Math.max(1, elapsedMs / 1000)).toFixed(2)),
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
        await cleanupRun({
          guildIds,
          sourceKeys: [initialSourceKey, canonicalSourceKey],
          query,
          withTransaction,
        });
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
