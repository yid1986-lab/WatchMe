const http = require("node:http");

const {
  buildSocialOriginFingerprint,
  buildSocialOriginKey,
} = require("../packages/shared/src");

const DEFAULT_DATABASE_URL = "postgres://watchme:watchme@127.0.0.1:5432/watchme_v2";

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address()));
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
        id: `instagram-inbound-message-${state.messages.length}`,
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
          id: `instagram-inbound-message-${index + 1}`,
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

async function main() {
  const originalInternalToken = process.env.INTERNAL_API_TOKEN;
  const originalDiscordToken = process.env.DISCORD_BOT_TOKEN;
  const originalDiscordBaseUrl = process.env.DISCORD_API_BASE_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalApiPort = process.env.API_PORT;
  const originalWorkerPort = process.env.WORKER_PORT;
  const originalWorkerQueues = process.env.WORKER_QUEUES;
  const originalWorkerPoll = process.env.WORKER_POLL_INTERVAL_MS;
  const originalWorkerBatch = process.env.WORKER_BATCH_SIZE;
  const originalWorkerConcurrency = process.env.WORKER_CONCURRENCY;
  const runId = `${Date.now()}`;
  const internalToken = `instagram-inbound-token-${runId}`;
  const apiPort = 39261;
  const workerPort = 39262;
  const discordPort = 39481;
  const guildId = `instagram-inbound-guild-${runId}`;
  const discordUserId = `instagram-inbound-user-${runId}`;
  const channelId = "instagram-inbound-channel-1";
  const externalAccountId = `ig-inbound-account-${runId}`;
  const externalAccountName = "WatchMe Creator Insta";
  const acceptedPostId = `ig-inbound-post-${runId}`;
  const blockedPostId = `ig-blocked-post-${runId}`;
  const discordState = { messages: [] };

  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  process.env.INTERNAL_API_TOKEN = internalToken;
  process.env.DISCORD_BOT_TOKEN = "instagram-inbound-bot-token";
  process.env.DISCORD_API_BASE_URL = `http://127.0.0.1:${discordPort}`;
  process.env.API_PORT = String(apiPort);
  process.env.WORKER_PORT = String(workerPort);
  process.env.WORKER_QUEUES = "platform_ingest,social_feed";
  process.env.WORKER_POLL_INTERVAL_MS = "50";
  process.env.WORKER_BATCH_SIZE = "50";
  process.env.WORKER_CONCURRENCY = "8";

  let createServer;
  let createCreatorPostDispatch;
  let saveCreatorProfile;
  let updateCreatorAccess;
  let upsertCreatorSocialConnection;
  let upsertGuildConfig;
  let apiClosePool = async () => {};
  let workerClosePool = async () => {};
  let query;
  let withTransaction;
  let startRunner = () => {};
  let stopRunner = () => {};
  let startWorkerServer = () => {};
  let stopWorkerServer = () => {};
  let apiServer = null;
  let discordServer = null;

  try {
    ({
      createServer,
    } = require("../apps/api/src/server"));
    ({
      createCreatorPostDispatch,
      saveCreatorProfile,
      updateCreatorAccess,
      upsertCreatorSocialConnection,
      upsertGuildConfig,
    } = require("../apps/api/src/queries"));
    ({
      closePool: apiClosePool,
    } = require("../apps/api/src/db"));
    ({
      closePool: workerClosePool,
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
          "Start a local Postgres instance for watchme-v2 before running the Instagram inbound smoke."
        );
      }
      throw error;
    }

    discordServer = await startDiscordStub(discordPort, discordState);
    apiServer = createServer();
    await listen(apiServer, apiPort);
    startWorkerServer();
    startRunner();

    await waitFor(async () => {
      try {
        const health = await requestJson(workerPort, "/health");
        return health?.ok === true;
      } catch {
        return false;
      }
    }, 10000, "worker health");

    const connection = await upsertCreatorSocialConnection(discordUserId, "instagram", {
      external_account_id: externalAccountId,
      external_account_name: externalAccountName,
      access_token: "ig-inbound-token",
      status: "active",
      metadata_json: {
        source: "instagram-inbound-check",
      },
    });

    await saveCreatorProfile(guildId, discordUserId, {
      display_name: "WatchMe Creator",
      twitch_url: null,
      twitch_external_id: null,
      youtube_url: null,
      youtube_external_id: null,
      kick_url: null,
      kick_external_id: null,
      kick_slug: null,
    });
    await updateCreatorAccess(guildId, discordUserId, {
      status: "approved",
      approved_by: "system",
      approved_at: new Date().toISOString(),
    });
    await upsertGuildConfig(guildId, {
      announce_channel_id: null,
      live_channel_id: null,
      socials_feed_channel_id: channelId,
      live_role_id: null,
      auto_cleanup: false,
      cooldown_seconds: 600,
      mention_mode: "role",
      brand_name: "WatchMe",
      brand_logo_url: "https://cdn.watchme.example/logo.png",
      preview_image_url: null,
      footer_text: "WatchMe social feed",
      guild_twitch_url: null,
      guild_youtube_url: null,
      guild_kick_url: null,
    });
    await query(
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
          status = EXCLUDED.status,
          updated_at = NOW()
      `,
      [guildId]
    );

    const dispatch = await createCreatorPostDispatch(discordUserId, {
      status: "completed",
      target_platforms_json: ["instagram"],
      payload_json: {
        source: "instagram-inbound-check",
      },
    });
    const originKey = buildSocialOriginKey({
      platform: "instagram",
      dispatchId: dispatch.dispatch_id,
    });
    const originFingerprint = buildSocialOriginFingerprint({
      originKey,
      discordUserId,
      connectionId: connection.connection_id,
    });

    await query(
      `
        INSERT INTO social_post_publications (
          dispatch_id,
          discord_user_id,
          platform,
          connection_id,
          status,
          origin_key,
          origin_fingerprint,
          external_account_id,
          external_post_id,
          external_app_id,
          external_url,
          external_created_at,
          payload_json,
          marker_json,
          error_json,
          updated_at
        )
        VALUES (
          $1, $2, 'instagram', $3, 'posted', $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, '{}'::jsonb, NOW()
        )
      `,
      [
        dispatch.dispatch_id,
        discordUserId,
        connection.connection_id,
        originKey,
        originFingerprint,
        externalAccountId,
        blockedPostId,
        "creator-instagram-app",
        `https://instagram.com/p/${blockedPostId}`,
        new Date().toISOString(),
        JSON.stringify({ source: "instagram-inbound-check" }),
        JSON.stringify({ originKey, originFingerprint }),
      ]
    );

    const blockedResponse = await requestJson(apiPort, "/api/internal/social-adapters/instagram/media", {
      method: "POST",
      token: internalToken,
      body: {
        account_id: externalAccountId,
        username: "watchme_creator",
        media_item: {
          id: blockedPostId,
          caption: "This should be blocked because WatchMe posted it.",
          permalink: `https://instagram.com/p/${blockedPostId}`,
          media_url: "https://cdn.watchme.example/blocked.jpg",
          timestamp: "2026-04-03T15:00:00.000Z",
          media_type: "IMAGE",
          media_product_type: "FEED",
        },
      },
    });

    const acceptedResponse = await requestJson(apiPort, "/api/internal/social-adapters/instagram/media", {
      method: "POST",
      token: internalToken,
      body: {
        account_id: externalAccountId,
        username: "watchme_creator",
        media_item: {
          id: acceptedPostId,
          caption: "Fresh creator Instagram content for the inbound adapter.",
          permalink: `https://instagram.com/p/${acceptedPostId}`,
          media_url: "https://cdn.watchme.example/accepted.jpg",
          timestamp: "2026-04-03T15:05:00.000Z",
          media_type: "IMAGE",
          media_product_type: "FEED",
        },
      },
    });

    await waitFor(async () => {
      const result = await query(
        `
          SELECT status, discord_message_id
          FROM post_history
          WHERE guild_id = $1
            AND platform = 'instagram'
            AND session_key = $2
          LIMIT 1
        `,
        [guildId, `social:instagram:${acceptedPostId}`]
      );

      return result.rows[0]?.status === "posted" && Boolean(result.rows[0]?.discord_message_id);
    }, 20000, "accepted Instagram inbound socials-feed post");

    const [acceptedEvent, blockedEvent, postHistoryResult] = await Promise.all([
      query(
        `
          SELECT event_id, processing_state, payload_json
          FROM event_ingest
          WHERE source_external_id = $1
          LIMIT 1
        `,
        [acceptedPostId]
      ),
      query(
        `
          SELECT event_id
          FROM event_ingest
          WHERE source_external_id = $1
          LIMIT 1
        `,
        [blockedPostId]
      ),
      query(
        `
          SELECT guild_id, status, discord_message_id
          FROM post_history
          WHERE guild_id = $1
            AND platform = 'instagram'
            AND session_key = $2
          LIMIT 1
        `,
        [guildId, `social:instagram:${acceptedPostId}`]
      ),
    ]);

    const summary = {
      ok: true,
      blockedResponse,
      acceptedResponse,
      acceptedEvent: acceptedEvent.rows[0] || null,
      blockedEvent: blockedEvent.rows[0] || null,
      postHistory: postHistoryResult.rows[0] || null,
      discordMessages: discordState.messages,
    };

    console.log(JSON.stringify(summary, null, 2));

    if (blockedResponse.accepted !== false || blockedResponse.ingested !== false) {
      throw new Error("Expected known WatchMe-origin Instagram media to be rejected before ingest.");
    }

    if (blockedEvent.rows.length !== 0) {
      throw new Error("Blocked Instagram media should not create an event_ingest row.");
    }

    if (acceptedResponse.accepted !== true || acceptedResponse.ingested !== true || acceptedResponse.enqueued !== true) {
      throw new Error("Expected accepted Instagram media to be ingested and queued.");
    }

    if (acceptedResponse.adapter !== "instagram_media") {
      throw new Error(`Unexpected adapter name ${acceptedResponse.adapter}`);
    }

    if (acceptedResponse.normalized?.ingested_via !== "instagram_inbound_adapter") {
      throw new Error("Expected Instagram adapter payload to stamp ingested_via.");
    }

    if ((acceptedEvent.rows[0] || {}).processing_state !== "processed") {
      throw new Error(`Expected accepted Instagram event to be processed, found ${(acceptedEvent.rows[0] || {}).processing_state}`);
    }

    const acceptedPayload = (acceptedEvent.rows[0] || {}).payload_json || {};
    if (acceptedPayload.content_type !== "image" || acceptedPayload.content_label !== "Image") {
      throw new Error("Expected accepted Instagram event payload to preserve content type metadata.");
    }

    if (acceptedPayload.external_account_handle !== "@watchme_creator") {
      throw new Error(`Unexpected Instagram account handle ${acceptedPayload.external_account_handle}`);
    }

    const postHistory = postHistoryResult.rows[0] || null;
    if (!postHistory || postHistory.status !== "posted") {
      throw new Error("Expected one posted socials-feed row for accepted Instagram inbound content.");
    }

    if (discordState.messages.length !== 1) {
      throw new Error(`Expected 1 Discord socials-feed message, found ${discordState.messages.length}`);
    }

    const embedTitle = discordState.messages[0]?.payload?.embeds?.[0]?.title || null;
    if (embedTitle !== "WatchMe Creator posted on Instagram") {
      throw new Error(`Unexpected Discord embed title ${embedTitle}`);
    }

    const embedFields = Array.isArray(discordState.messages[0]?.payload?.embeds?.[0]?.fields)
      ? discordState.messages[0].payload.embeds[0].fields
      : [];
    if (!embedFields.some((field) => field.name === "Type" && field.value === "Image")) {
      throw new Error("Expected Discord socials-feed embed to include the Instagram content type.");
    }
  } finally {
    stopRunner();
    stopWorkerServer();

    try {
      if (query && withTransaction) {
        await withTransaction(async (client) => {
          await client.query(
            `
              DELETE FROM job_queue
              WHERE (payload_json->>'sourceExternalId') IN ($1, $2)
                 OR (payload_json->>'guildId') = $3
            `,
            [acceptedPostId, blockedPostId, guildId]
          );
          await client.query(
            `
              DELETE FROM post_history
              WHERE guild_id = $1
            `,
            [guildId]
          );
          await client.query(
            `
              DELETE FROM event_ingest
              WHERE source_external_id IN ($1, $2)
            `,
            [acceptedPostId, blockedPostId]
          );
          await client.query(
            `
              DELETE FROM social_post_publications
              WHERE external_post_id = $1
            `,
            [blockedPostId]
          );
          await client.query(
            `
              DELETE FROM creator_post_dispatches
              WHERE discord_user_id = $1
            `,
            [discordUserId]
          );
          await client.query(
            `
              DELETE FROM pro_entitlements
              WHERE bound_guild_id = $1
            `,
            [guildId]
          );
          await client.query(
            `
              DELETE FROM creator_social_connections
              WHERE discord_user_id = $1
            `,
            [discordUserId]
          );
          await client.query(
            `
              DELETE FROM creator_access
              WHERE guild_id = $1
                AND discord_user_id = $2
            `,
            [guildId, discordUserId]
          );
          await client.query(
            `
              DELETE FROM creator_profiles
              WHERE guild_id = $1
                AND discord_user_id = $2
            `,
            [guildId, discordUserId]
          );
          await client.query(
            `
              DELETE FROM guild_config
              WHERE guild_id = $1
            `,
            [guildId]
          );
          await client.query(
            `
              DELETE FROM users
              WHERE discord_user_id = $1
            `,
            [discordUserId]
          );
          await client.query(
            `
              DELETE FROM guilds
              WHERE guild_id = $1
            `,
            [guildId]
          );
        });
      }
    } finally {
      if (apiServer) {
        await new Promise((resolve) => apiServer.close(resolve));
      }

      if (discordServer) {
        await new Promise((resolve) => discordServer.close(resolve));
      }

      await apiClosePool().catch(() => null);
      await workerClosePool().catch(() => null);

      process.env.INTERNAL_API_TOKEN = originalInternalToken;
      process.env.DISCORD_BOT_TOKEN = originalDiscordToken;
      process.env.DISCORD_API_BASE_URL = originalDiscordBaseUrl;
      process.env.DATABASE_URL = originalDatabaseUrl;
      process.env.API_PORT = originalApiPort;
      process.env.WORKER_PORT = originalWorkerPort;
      process.env.WORKER_QUEUES = originalWorkerQueues;
      process.env.WORKER_POLL_INTERVAL_MS = originalWorkerPoll;
      process.env.WORKER_BATCH_SIZE = originalWorkerBatch;
      process.env.WORKER_CONCURRENCY = originalWorkerConcurrency;
    }
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
