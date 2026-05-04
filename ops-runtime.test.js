const http = require("node:http");

const DEFAULT_DATABASE_URL = "postgres://watchme:watchme@127.0.0.1:5432/watchme_v2";

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

function buildChannelId(index) {
  return `social-feed-channel-${String(index + 1).padStart(4, "0")}`;
}

function buildPostId(runId, index) {
  return `ig-social-feed-${runId.toLowerCase()}-${String(index + 1).padStart(4, "0")}`;
}

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address()));
  });
}

function readJsonResponse(response) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
      }

      if (response.statusCode >= 400) {
        reject(new Error(`HTTP ${response.statusCode}: ${text}`));
        return;
      }

      resolve(data);
    });
  });
}

function requestJson(port, path, { method = "GET", body = null, token = null } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { "x-internal-token": token } : {}),
        },
      },
      (response) => {
        readJsonResponse(response).then(resolve).catch(reject);
      }
    );

    request.once("error", reject);
    if (body) {
      request.write(JSON.stringify(body));
    }
    request.end();
  });
}

function startDiscordStub(port, state) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const channelMatch = url.pathname.match(/^\/channels\/([^/]+)\/messages$/);

    if (channelMatch && req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }

      let payload = {};
      try {
        payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      } catch {
        payload = {};
      }

      const channelId = decodeURIComponent(channelMatch[1]);
      state.messages.push({
        channelId,
        payload,
      });

      const body = JSON.stringify({
        id: `social-feed-message-${state.messages.length}`,
        channel_id: channelId,
        ...payload,
      });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    if (channelMatch && req.method === "GET") {
      const channelId = decodeURIComponent(channelMatch[1]);
      const messages = state.messages
        .filter((item) => item.channelId === channelId)
        .map((item, index) => ({
          id: `social-feed-message-${index + 1}`,
          channel_id: channelId,
          ...item.payload,
        }));
      const body = JSON.stringify(messages);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { message: "Not found" } }));
  });

  return listen(server, port).then(() => server);
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

async function seedSocialFeedTargets({
  guildIds,
  discordUserId,
  externalAccountId,
  externalAccountName,
  runId,
  query,
  withTransaction,
}) {
  const approvedAt = new Date().toISOString();

  await withTransaction(async (client) => {
    await client.query(
      `
        INSERT INTO users (discord_user_id, username, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (discord_user_id) DO UPDATE SET
          username = EXCLUDED.username,
          updated_at = NOW()
      `,
      [discordUserId, "watchme-social-feed-stress"]
    );

    await client.query(
      `
        INSERT INTO creator_social_connections (
          discord_user_id,
          platform,
          external_account_id,
          external_account_name,
          access_token,
          status,
          metadata_json,
          updated_at
        )
        VALUES ($1, 'instagram', $2, $3, $4, 'active', $5::jsonb, NOW())
        ON CONFLICT (discord_user_id, platform) DO UPDATE SET
          external_account_id = EXCLUDED.external_account_id,
          external_account_name = EXCLUDED.external_account_name,
          access_token = EXCLUDED.access_token,
          status = EXCLUDED.status,
          metadata_json = EXCLUDED.metadata_json,
          updated_at = NOW()
      `,
      [
        discordUserId,
        externalAccountId,
        externalAccountName,
        "ig-social-feed-token",
        JSON.stringify({
          source: "social-feed-stress",
          runId,
        }),
      ]
    );

    for (let index = 0; index < guildIds.length; index += 1) {
      const guildId = guildIds[index];
      const channelId = buildChannelId(index);

      await client.query(
        `
          INSERT INTO guilds (guild_id, name, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (guild_id) DO UPDATE SET
            name = EXCLUDED.name,
            updated_at = NOW()
        `,
        [guildId, `Social Feed Stress Guild ${index + 1}`]
      );

      await client.query(
        `
          INSERT INTO guild_config (
            guild_id,
            announce_channel_id,
            live_channel_id,
            socials_feed_channel_id,
            mention_mode,
            brand_name,
            brand_logo_url,
            footer_text,
            updated_at
          )
          VALUES ($1, NULL, NULL, $2, 'role', $3, $4, $5, NOW())
          ON CONFLICT (guild_id) DO UPDATE SET
            announce_channel_id = EXCLUDED.announce_channel_id,
            live_channel_id = EXCLUDED.live_channel_id,
            socials_feed_channel_id = EXCLUDED.socials_feed_channel_id,
            mention_mode = EXCLUDED.mention_mode,
            brand_name = EXCLUDED.brand_name,
            brand_logo_url = EXCLUDED.brand_logo_url,
            footer_text = EXCLUDED.footer_text,
            updated_at = NOW()
        `,
        [
          guildId,
          channelId,
          "WatchMe Social Feed",
          "https://cdn.watchme.example/logo.png",
          `Social feed stress ${runId}`,
        ]
      );

      await client.query(
        `
          INSERT INTO creator_profiles (
            guild_id,
            discord_user_id,
            display_name,
            updated_at
          )
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            updated_at = NOW()
        `,
        [guildId, discordUserId, "WatchMe Creator"]
      );

      await client.query(
        `
          INSERT INTO creator_access (
            guild_id,
            discord_user_id,
            status,
            approved_by,
            approved_at,
            updated_at
          )
          VALUES ($1, $2, 'approved', 'system', $3, NOW())
          ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
            status = 'approved',
            approved_by = EXCLUDED.approved_by,
            approved_at = EXCLUDED.approved_at,
            updated_at = NOW()
        `,
        [guildId, discordUserId, approvedAt]
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
    }
  });
}

async function cleanupRun({
  guildIds,
  discordUserId,
  sourceKey,
  externalPostIds,
  query,
  withTransaction,
}) {
  await withTransaction(async (client) => {
    await client.query(
      `
        DELETE FROM job_queue
        WHERE (payload_json->>'guildId') = ANY($1::text[])
           OR (payload_json->>'sourceKey') = $2
           OR (payload_json->>'sourceExternalId') = ANY($3::text[])
      `,
      [guildIds, sourceKey, externalPostIds]
    );

    await client.query(
      `
        DELETE FROM post_history
        WHERE guild_id = ANY($1::text[])
          AND session_key LIKE 'social:%'
      `,
      [guildIds]
    );

    await client.query(
      `
        DELETE FROM event_ingest
        WHERE source_key = $1
           OR source_external_id = ANY($2::text[])
      `,
      [sourceKey, externalPostIds]
    );

    await client.query(
      `
        DELETE FROM creator_social_connections
        WHERE discord_user_id = $1
          AND platform = 'instagram'
      `,
      [discordUserId]
    );

    await client.query(
      `
        DELETE FROM creator_access
        WHERE guild_id = ANY($1::text[])
          AND discord_user_id = $2
      `,
      [guildIds, discordUserId]
    );

    await client.query(
      `
        DELETE FROM creator_profiles
        WHERE guild_id = ANY($1::text[])
          AND discord_user_id = $2
      `,
      [guildIds, discordUserId]
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

    await client.query(
      `
        DELETE FROM users
        WHERE discord_user_id = $1
      `,
      [discordUserId]
    );
  });
}

async function countPostedSocialFeedPosts(query, guildIds) {
  const result = await query(
    `
      SELECT COUNT(*)::int AS total
      FROM post_history
      WHERE guild_id = ANY($1::text[])
        AND session_key LIKE 'social:%'
        AND status = 'posted'
    `,
    [guildIds]
  );

  return Number(result.rows[0]?.total || 0);
}

async function countFailedJobs(query, guildIds, sourceKey, externalPostIds) {
  const result = await query(
    `
      SELECT COUNT(*)::int AS total
      FROM job_queue
      WHERE status = 'failed'
        AND (
          (payload_json->>'guildId') = ANY($1::text[])
          OR (payload_json->>'sourceKey') = $2
          OR (payload_json->>'sourceExternalId') = ANY($3::text[])
        )
    `,
    [guildIds, sourceKey, externalPostIds]
  );

  return Number(result.rows[0]?.total || 0);
}

async function countFailedPosts(query, guildIds) {
  const result = await query(
    `
      SELECT COUNT(*)::int AS total
      FROM post_history
      WHERE guild_id = ANY($1::text[])
        AND session_key LIKE 'social:%'
        AND status = 'failed'
    `,
    [guildIds]
  );

  return Number(result.rows[0]?.total || 0);
}

async function waitForPostedSocialFeedPosts(query, guildIds, expectedCount, timeoutMs) {
  await waitFor(async () => {
    return (await countPostedSocialFeedPosts(query, guildIds)) >= expectedCount;
  }, timeoutMs, `${expectedCount} social feed deliveries`);
}

async function waitForSocialWorkDrain(query, sourceKey, externalPostIds, timeoutMs) {
  await waitFor(async () => {
    const [jobs, ingest] = await Promise.all([
      query(
        `
          SELECT COUNT(*)::int AS total
          FROM job_queue
          WHERE status IN ('pending', 'processing')
            AND (
              (payload_json->>'sourceKey') = $1
              OR (payload_json->>'sourceExternalId') = ANY($2::text[])
            )
        `,
        [sourceKey, externalPostIds]
      ),
      query(
        `
          SELECT COUNT(*)::int AS total
          FROM event_ingest
          WHERE source_key = $1
            AND source_external_id = ANY($2::text[])
            AND processing_state IN ('received', 'queued', 'processing')
        `,
        [sourceKey, externalPostIds]
      ),
    ]);

    return Number(jobs.rows[0]?.total || 0) === 0 && Number(ingest.rows[0]?.total || 0) === 0;
  }, timeoutMs, "social feed queue drain");
}

async function waitForWorkerHealth(port) {
  await waitFor(async () => {
    try {
      const result = await requestJson(port, "/health");
      return result?.ok === true;
    } catch {
      return false;
    }
  }, 10000, "worker health");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guildCount = getNumberArg(args, "guilds", 1000);
  const eventCount = getNumberArg(args, "events", 3);
  const timeoutMs = getNumberArg(args, "timeoutMs", 300000);
  const apiPort = getNumberArg(args, "apiPort", 39241);
  const workerPort = getNumberArg(args, "workerPort", 39242);
  const discordPort = getNumberArg(args, "discordPort", 39471);
  const runId = buildRunId();
  const guildPrefix = `social-feed-stress-${runId.toLowerCase()}`;
  const guildIds = Array.from({ length: guildCount }, (_, index) => buildGuildId(guildPrefix, index));
  const discordUserId = `social-feed-user-${runId.toLowerCase()}`;
  const externalAccountId = `ig-feed-${runId.toLowerCase()}`;
  const externalAccountName = "WatchMe Insta Feed";
  const sourceKey = `instagram:${externalAccountId}`;
  const externalPostIds = Array.from({ length: eventCount }, (_, index) => buildPostId(runId, index));
  const expectedPosts = guildCount * eventCount;
  const internalToken = `social-feed-token-${runId.toLowerCase()}`;
  const discordState = { messages: [] };
  const startedAt = Date.now();

  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  process.env.INTERNAL_API_TOKEN = internalToken;
  process.env.DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "test-social-feed-bot-token";
  process.env.DISCORD_API_BASE_URL = `http://127.0.0.1:${discordPort}`;
  process.env.WORKER_NAME = `watchme-v2-social-feed-${runId.toLowerCase()}`;
  process.env.WORKER_PORT = String(workerPort);
  process.env.WORKER_QUEUES = "platform_ingest,social_feed";
  process.env.WORKER_POLL_INTERVAL_MS = "50";
  process.env.WORKER_BATCH_SIZE = String(Math.min(250, Math.max(25, guildCount)));
  process.env.WORKER_CONCURRENCY = String(Math.min(32, Math.max(4, Math.ceil(guildCount / 50))));

  let apiServer = null;
  let discordServer = null;
  let startRunner = () => {};
  let stopRunner = () => {};
  let startWorkerServer = () => {};
  let stopWorkerServer = () => {};
  let query = null;
  let withTransaction = null;
  let closeWorkerPool = async () => {};
  let closeApiPool = async () => {};

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
      startServer: startWorkerServer,
      stopServer: stopWorkerServer,
    } = require("../apps/worker/src/server"));

    try {
      await query("SELECT 1");
    } catch (error) {
      if (String(error?.message || "").includes("ECONNREFUSED")) {
        throw new Error(
          `Database connection failed for ${process.env.DATABASE_URL || "DATABASE_URL"}. ` +
          "Start a local Postgres instance for watchme-v2 before running social feed stress checks."
        );
      }
      throw error;
    }

    discordServer = await startDiscordStub(discordPort, discordState);
    apiServer = createServer();
    await listen(apiServer, apiPort);

    await cleanupRun({
      guildIds,
      discordUserId,
      sourceKey,
      externalPostIds,
      query,
      withTransaction,
    });

    await seedSocialFeedTargets({
      guildIds,
      discordUserId,
      externalAccountId,
      externalAccountName,
      runId,
      query,
      withTransaction,
    });

    const ingestResponses = [];
    for (let index = 0; index < eventCount; index += 1) {
      const externalPostId = externalPostIds[index];
      const publishedAt = new Date(Date.UTC(2026, 3, 3, 13, index, 0)).toISOString();
      ingestResponses.push(await requestJson(apiPort, "/api/internal/social-events", {
        method: "POST",
        token: internalToken,
        body: {
          platform: "instagram",
          external_account_id: externalAccountId,
          external_account_name: externalAccountName,
          external_post_id: externalPostId,
          external_app_id: "creator-instagram-app",
          external_post_url: `https://instagram.com/p/${externalPostId}`,
          source_url: "https://instagram.com/watchme_creator",
          normalized_text: `Social feed stress post ${index + 1}`,
          normalized_urls: [`https://instagram.com/p/${externalPostId}`],
          media_urls_json: [`https://cdn.watchme.example/${externalPostId}.jpg`],
          published_at: publishedAt,
          metadata_json: {
            source: "social-feed-stress",
            runId,
            index: index + 1,
          },
        },
      }));
    }

    const initialOps = await requestJson(apiPort, "/api/internal/ops/queues", {
      token: internalToken,
    });

    if (Number(initialOps?.summary?.socialFeed?.ingest?.backlog || 0) < eventCount) {
      throw new Error("Expected social feed ingest backlog before the runner starts.");
    }

    if (Number(initialOps?.queueBreakdown?.platform_ingest?.pending || 0) < eventCount) {
      throw new Error("Expected platform_ingest pending jobs before the runner starts.");
    }

    startWorkerServer();
    await waitForWorkerHealth(workerPort);
    startRunner();

    await waitForPostedSocialFeedPosts(query, guildIds, expectedPosts, timeoutMs);
    await waitForSocialWorkDrain(query, sourceKey, externalPostIds, timeoutMs);

    const [posted, failedJobs, failedPosts, finalOps, runtime] = await Promise.all([
      countPostedSocialFeedPosts(query, guildIds),
      countFailedJobs(query, guildIds, sourceKey, externalPostIds),
      countFailedPosts(query, guildIds),
      requestJson(apiPort, "/api/internal/ops/queues", {
        token: internalToken,
      }),
      requestJson(workerPort, "/ops/runtime", {
        token: internalToken,
      }),
    ]);

    const elapsedMs = Date.now() - startedAt;
    const summary = {
      ok: true,
      guildCount,
      eventCount,
      expectedPosts,
      posted,
      failedJobs,
      failedPosts,
      ingestResponses: ingestResponses.length,
      discordMessages: discordState.messages.length,
      initialOps: {
        readyJobs: Number(initialOps?.summary?.jobs?.ready || 0),
        socialFeedIngestBacklog: Number(initialOps?.summary?.socialFeed?.ingest?.backlog || 0),
        platformIngestPending: Number(initialOps?.queueBreakdown?.platform_ingest?.pending || 0),
        socialFeedPending: Number(initialOps?.queueBreakdown?.social_feed?.pending || 0),
      },
      finalOps: {
        warnings: Array.isArray(finalOps?.warnings) ? finalOps.warnings : [],
        socialFeed: finalOps?.summary?.socialFeed || null,
      },
      workerRuntime: runtime?.runtime || null,
      elapsedMs,
      deliveriesPerSecond: Number((posted / Math.max(1, elapsedMs / 1000)).toFixed(2)),
      runId,
    };

    console.log(JSON.stringify(summary, null, 2));

    if (posted !== expectedPosts) {
      throw new Error(`Expected ${expectedPosts} social feed posts but found ${posted}.`);
    }

    if (discordState.messages.length !== expectedPosts) {
      throw new Error(`Expected ${expectedPosts} Discord messages but found ${discordState.messages.length}.`);
    }

    if (failedJobs > 0 || failedPosts > 0) {
      throw new Error(`Social feed stress recorded failed work (failedJobs=${failedJobs}, failedPosts=${failedPosts}).`);
    }

    if (Number(finalOps?.summary?.socialFeed?.ingest?.backlog || 0) !== 0) {
      throw new Error("Expected social feed ingest backlog to drain to zero.");
    }

    if (Number(finalOps?.summary?.socialFeed?.jobs?.ready || 0) !== 0) {
      throw new Error("Expected social feed ready jobs to drain to zero.");
    }

    if (Number(finalOps?.summary?.socialFeed?.jobs?.processing || 0) !== 0) {
      throw new Error("Expected social feed processing jobs to drain to zero.");
    }

    if (Number(finalOps?.summary?.socialFeed?.posts?.posted || 0) < expectedPosts) {
      throw new Error("Expected social feed ops summary to report all posted deliveries.");
    }

    const sampleTitle = discordState.messages[0]?.payload?.embeds?.[0]?.title || null;
    if (sampleTitle !== "WatchMe Creator posted on Instagram") {
      throw new Error(`Unexpected first social feed embed title ${sampleTitle}`);
    }
  } finally {
    stopRunner();
    stopWorkerServer();

    if (apiServer) {
      await new Promise((resolve) => apiServer.close(resolve));
    }

    if (discordServer) {
      await new Promise((resolve) => discordServer.close(resolve));
    }

    if (query && withTransaction) {
      try {
        await cleanupRun({
          guildIds,
          discordUserId,
          sourceKey,
          externalPostIds,
          query,
          withTransaction,
        });
      } catch {
        // Best-effort cleanup only for local social feed stress ids.
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
