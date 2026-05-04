const http = require("node:http");
const crypto = require("node:crypto");

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
  const digits = String(runId || "").replace(/\D/g, "") || "123456789";
  return (digits + "123456789012").slice(0, 12);
}

function buildKickSlug(runId) {
  return `watchme-${String(runId || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 18)}`;
}

function buildGuildId(prefix, index) {
  return `${prefix}-g${String(index + 1).padStart(4, "0")}`;
}

function buildChannelName(index) {
  return `kick-channel-${String(index + 1).padStart(4, "0")}`;
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

async function waitForCanonicalSubscriptions({ guildIds, sourceKey, expectedCount, query, timeoutMs }) {
  await waitFor(async () => {
    const result = await query(
      `
        SELECT COUNT(*)::int AS total
        FROM platform_subscriptions
        WHERE guild_id = ANY($1::text[])
          AND platform = 'kick'
          AND topic_key = $2
          AND status = 'active'
      `,
      [guildIds, sourceKey]
    );

    return Number(result.rows[0]?.total || 0) >= expectedCount;
  }, timeoutMs, `${expectedCount} canonical Kick subscriptions`);
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

function buildKickChannelPayload(broadcasterId, slug) {
  return {
    broadcaster_user_id: Number(broadcasterId),
    slug,
    username: slug,
    profile_picture: `https://images.example/${encodeURIComponent(slug)}-profile.jpg`,
    banner_picture: `https://images.example/${encodeURIComponent(slug)}-banner.jpg`,
    category: {
      name: "Gaming",
    },
  };
}

function buildKickLivestreamPayload(broadcasterId, slug, index) {
  return {
    broadcaster_user_id: Number(broadcasterId),
    slug,
    stream_title: `Kick stress stream ${index + 1}`,
    category: {
      name: "Gaming",
    },
    viewer_count: 42 + index,
    started_at: new Date(Date.UTC(2026, 3, 2, 10, index, 0)).toISOString(),
    thumbnail: `https://images.example/${encodeURIComponent(slug)}-${index + 1}.jpg`,
  };
}

function buildKickWebhookPayload(broadcasterId, slug, index) {
  const livestream = buildKickLivestreamPayload(broadcasterId, slug, index);
  return {
    broadcaster: {
      user_id: Number(broadcasterId),
      channel_slug: slug,
      username: slug,
      profile_picture: `https://images.example/${encodeURIComponent(slug)}-profile.jpg`,
    },
    is_live: true,
    title: livestream.stream_title,
    started_at: livestream.started_at,
    ended_at: null,
    metadata: {
      title: livestream.stream_title,
      category: {
        name: livestream.category.name,
      },
    },
  };
}

async function startStubServer(port, state) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);

    if (req.method === "POST" && url.pathname === "/kick/oauth/token") {
      return sendJson(res, 200, {
        access_token: "kick-stub-token",
        expires_in: 3600,
        token_type: "Bearer",
      });
    }

    if (req.method === "GET" && url.pathname === "/kick/public-key") {
      return sendJson(res, 200, {
        data: {
          public_key: state.publicKeyPem,
        },
      });
    }

    if (req.method === "GET" && url.pathname === "/kick/public/v1/channels") {
      const broadcasterId = String(url.searchParams.get("broadcaster_user_id") || "").trim();
      const slug = String(url.searchParams.get("slug") || "").trim().toLowerCase();
      const channel = broadcasterId
        ? state.channelsById.get(broadcasterId) || null
        : state.channelsBySlug.get(slug) || null;

      return sendJson(res, 200, {
        data: channel ? [channel] : [],
      });
    }

    if (req.method === "GET" && url.pathname === "/kick/public/v1/livestreams") {
      const broadcasterId = String(url.searchParams.get("broadcaster_user_id") || "").trim();
      const livestream = state.livestreams.get(broadcasterId) || null;

      return sendJson(res, 200, {
        data: livestream ? [livestream] : [],
      });
    }

    if (req.method === "GET" && url.pathname === "/kick/public/v1/events/subscriptions") {
      const broadcasterId = String(url.searchParams.get("broadcaster_user_id") || "").trim();
      const subscriptions = state.eventSubscriptions.filter((item) => item.broadcaster_user_id === broadcasterId);
      return sendJson(res, 200, {
        data: subscriptions,
      });
    }

    if (req.method === "POST" && url.pathname === "/kick/public/v1/events/subscriptions") {
      const rawBody = await readRawBody(req);
      let payload = {};
      try {
        payload = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
      } catch {
        payload = {};
      }

      const broadcasterId = String(payload.broadcaster_user_id || "").trim();
      const created = Array.isArray(payload.events)
        ? payload.events.map((event, index) => ({
            id: `kick-sub-${state.eventSubscriptions.length + index + 1}`,
            broadcaster_user_id: broadcasterId,
            event: String(event.name || "").trim().toLowerCase(),
            version: Number(event.version || 1),
            status: "active",
          }))
        : [];

      state.eventSubscriptions.push(...created);
      state.subscribeCalls.push(created);

      return sendJson(res, 201, {
        data: created,
      });
    }

    if (req.method === "DELETE" && url.pathname === "/kick/public/v1/events/subscriptions") {
      const ids = url.searchParams.getAll("id");
      state.eventSubscriptions = state.eventSubscriptions.filter((item) => !ids.includes(String(item.id)));
      return sendJson(res, 200, { ok: true });
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

async function seedGuildSubscriptions({ guildIds, initialSourceKey, broadcasterId, slug, webhookUrl, runId, query, withTransaction }) {
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
        [guildId, `Kick Stress Guild ${index + 1}`]
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
            guild_kick_url,
            updated_at
          )
          VALUES ($1, $2, $2, 'role', $3, $4, $5, NOW())
          ON CONFLICT (guild_id) DO UPDATE SET
            live_channel_id = EXCLUDED.live_channel_id,
            announce_channel_id = EXCLUDED.announce_channel_id,
            mention_mode = EXCLUDED.mention_mode,
            brand_name = EXCLUDED.brand_name,
            footer_text = EXCLUDED.footer_text,
            guild_kick_url = EXCLUDED.guild_kick_url,
            updated_at = NOW()
        `,
        [
          guildId,
          liveChannelId,
          "WatchMe Kick Stress",
          `Run ${runId}`,
          `https://kick.com/${slug}`,
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
          VALUES ($1, 'kick', $2, $3, 'active', $4::jsonb, NOW())
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
            sourceUrl: `https://kick.com/${slug}`,
            broadcasterId,
            broadcasterSlug: slug,
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
      WHERE platform = 'kick'
        AND guild_id = $1
      ORDER BY subscription_id ASC
      LIMIT 1
    `,
    [guildIds[0]]
  );

  return result.rows[0] || null;
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

function buildSignedKickRequest(privateKey, eventType, body) {
  const messageId = `kick-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = new Date().toISOString();
  const rawBody = Buffer.from(JSON.stringify(body));
  const signedPayload = Buffer.concat([
    Buffer.from(messageId, "utf8"),
    Buffer.from(".", "utf8"),
    Buffer.from(timestamp, "utf8"),
    Buffer.from(".", "utf8"),
    rawBody,
  ]);
  const signature = crypto.sign("RSA-SHA256", signedPayload, privateKey).toString("base64");

  return {
    headers: {
      "Content-Type": "application/json",
      "Kick-Event-Type": eventType,
      "Kick-Event-Message-Id": messageId,
      "Kick-Event-Message-Timestamp": timestamp,
      "Kick-Event-Signature": signature,
    },
    body: rawBody.toString("utf8"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = String(args.mode || "smoke").trim().toLowerCase();
  const guildCount = getNumberArg(args, "guilds", mode === "stress" ? 1000 : 5);
  const eventCount = getNumberArg(args, "events", mode === "stress" ? 3 : 1);
  const timeoutMs = getNumberArg(args, "timeoutMs", mode === "stress" ? 300000 : 120000);
  const workerPort = getNumberArg(args, "workerPort", 39202);
  const stubPort = getNumberArg(args, "stubPort", 39290);
  const runId = buildRunId();
  const broadcasterId = buildBroadcasterId(runId);
  const slug = buildKickSlug(runId);
  const initialSourceKey = `kick:${slug}`;
  const canonicalSourceKey = `kick:${broadcasterId}`;
  const guildPrefix = `stress-kick-${mode}-${runId.toLowerCase()}`;
  const guildIds = Array.from({ length: guildCount }, (_, index) => buildGuildId(guildPrefix, index));
  const workerBaseUrl = `http://127.0.0.1:${workerPort}`;
  const stubBaseUrl = `http://127.0.0.1:${stubPort}`;

  process.env.NODE_ENV = "test";
  process.env.WORKER_NAME = `watchme-v2-kick-${mode}-worker`;
  process.env.WORKER_PORT = String(workerPort);
  process.env.WORKER_POLL_INTERVAL_MS = "50";
  process.env.WORKER_BATCH_SIZE = String(Math.min(250, Math.max(25, guildCount)));
  process.env.WORKER_CONCURRENCY = String(Math.min(32, Math.max(4, Math.ceil(guildCount / 50))));
  process.env.DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "test-bot-token";
  process.env.DISCORD_API_BASE_URL = `${stubBaseUrl}/discord/api/v10`;
  process.env.KICK_CLIENT_ID = process.env.KICK_CLIENT_ID || "kick-stub-client";
  process.env.KICK_CLIENT_SECRET = process.env.KICK_CLIENT_SECRET || "kick-stub-secret";
  process.env.KICK_API_BASE_URL = `${stubBaseUrl}/kick/public/v1`;
  process.env.KICK_TOKEN_URL = `${stubBaseUrl}/kick/oauth/token`;
  process.env.KICK_PUBLIC_KEY_URL = `${stubBaseUrl}/kick/public-key`;
  process.env.KICK_WEBHOOK_BASE_URL = workerBaseUrl;
  process.env.KICK_WEBHOOK_PATH = "/webhooks/kick";

  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  const state = {
    subscribeCalls: [],
    eventSubscriptions: [],
    channelsById: new Map(),
    channelsBySlug: new Map(),
    livestreams: new Map(),
    discordMessages: [],
    deletedMessages: [],
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };

  state.channelsById.set(broadcasterId, buildKickChannelPayload(broadcasterId, slug));
  state.channelsBySlug.set(slug, buildKickChannelPayload(broadcasterId, slug));

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
      slug,
      webhookUrl: `${workerBaseUrl}/webhooks/kick`,
      runId,
      query,
      withTransaction,
    });

    if (!leader?.subscription_id) {
      throw new Error("Failed to seed the leader Kick subscription.");
    }

    await enqueuePlatformSubscriptionRenewalJob({
      subscriptionId: leader.subscription_id,
      platform: "kick",
      topicKey: leader.topic_key,
      guildId: leader.guild_id,
      scope: "guild",
      metadata: leader.metadata_json || {},
    });

    await waitFor(() => state.eventSubscriptions.length >= 2, timeoutMs, "the Kick renewal job");
    await waitForCanonicalSubscriptions({
      guildIds,
      sourceKey: canonicalSourceKey,
      expectedCount: guildCount,
      query,
      timeoutMs,
    });

    for (let index = 0; index < eventCount; index += 1) {
      state.livestreams.set(broadcasterId, buildKickLivestreamPayload(broadcasterId, slug, index));
      const request = buildSignedKickRequest(
        privateKey,
        "livestream.status.updated",
        buildKickWebhookPayload(broadcasterId, slug, index)
      );

      const response = await requestJson(`${workerBaseUrl}/webhooks/kick`, {
        method: "POST",
        headers: request.headers,
        body: request.body,
      });

      if (!response?.ok) {
        throw new Error(`Worker did not accept Kick event ${index + 1}`);
      }

      const expectedSoFar = guildCount * (index + 1);
      await waitFor(async () => {
        const result = await query(
          `
            SELECT COUNT(*)::int AS total
            FROM post_history
            WHERE guild_id = ANY($1::text[])
              AND platform = 'kick'
              AND status = 'posted'
          `,
          [guildIds]
        );

        return Number(result.rows[0]?.total || 0) >= expectedSoFar;
      }, timeoutMs, `${expectedSoFar} delivered Kick posts`);
    }

    const expectedPosts = guildCount * eventCount;
    const [postedResult, failedJobsResult, failedPostsResult] = await Promise.all([
      query(
        `
          SELECT COUNT(*)::int AS total
          FROM post_history
          WHERE guild_id = ANY($1::text[])
            AND platform = 'kick'
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
            AND platform = 'kick'
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
      throw new Error(`Kick run recorded failed work (failedJobs=${failedJobs}, failedPosts=${failedPosts}).`);
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
      eventSubscriptions: state.eventSubscriptions.length,
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
