const http = require("node:http");
const { Pool } = require("pg");

const {
  saveCreatorProfile,
  updateCreatorAccess,
  upsertCreatorSocialConnection,
  upsertGuildConfig,
} = require("../apps/api/src/queries");
const { createServer } = require("../apps/api/src/server");
const apiDb = require("../apps/api/src/db");
const { handleJob } = require("../apps/worker/src/handlers");
const workerDb = require("../apps/worker/src/db");

const DEFAULT_DATABASE_URL = "postgres://watchme:watchme@127.0.0.1:5432/watchme_v2";

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address()));
  });
}

function postJson(port, path, body, token) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": token,
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
    request.write(JSON.stringify(body || {}));
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

      const bodyText = Buffer.concat(chunks).toString("utf8");
      const payload = bodyText ? JSON.parse(bodyText) : {};
      const channelId = decodeURIComponent(channelMatch[1]);
      state.messages.push({
        channelId,
        payload,
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: `social-feed-message-${state.messages.length}`,
        channel_id: channelId,
        ...payload,
      }));
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

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(messages));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Not found" } }));
  });

  return listen(server, port).then(() => server);
}

async function getJobByType(pool, jobType, eventId) {
  const result = await pool.query(
    `
      SELECT *
      FROM job_queue
      WHERE job_type = $1
        AND payload_json->>'eventId' = $2
      ORDER BY job_id ASC
      LIMIT 1
    `,
    [jobType, String(eventId)]
  );

  return result.rows[0] || null;
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  });

  const originalInternalToken = process.env.INTERNAL_API_TOKEN;
  const originalDiscordToken = process.env.DISCORD_BOT_TOKEN;
  const originalDiscordBaseUrl = process.env.DISCORD_API_BASE_URL;
  const internalToken = "social-feed-check-token";
  const guildId = `social-feed-guild-${Date.now()}`;
  const discordUserId = `social-feed-user-${Date.now()}`;
  const discordChannelId = "social-feed-channel-1";
  const discordState = { messages: [] };
  let apiServer = null;
  let discordServer = null;

  try {
    process.env.INTERNAL_API_TOKEN = internalToken;
    process.env.DISCORD_BOT_TOKEN = "discord-social-feed-token";

    discordServer = await startDiscordStub(39461, discordState);
    process.env.DISCORD_API_BASE_URL = "http://127.0.0.1:39461";

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
      socials_feed_channel_id: discordChannelId,
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
    await upsertCreatorSocialConnection(discordUserId, "instagram", {
      external_account_id: "ig-user-feed",
      external_account_name: "WatchMe Insta Feed",
      access_token: "ig-feed-token",
      status: "active",
      metadata_json: {
        source: "social-feed-check",
      },
    });
    await pool.query(
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

    apiServer = createServer();
    const apiAddress = await listen(apiServer);

    const acceptedResponse = await postJson(apiAddress.port, "/api/internal/social-events", {
      platform: "instagram",
      external_account_id: "ig-user-feed",
      external_account_name: "WatchMe Insta Feed",
      external_post_id: "ig-feed-post-1",
      external_app_id: "creator-instagram-app",
      external_post_url: "https://instagram.com/p/ig-feed-post-1",
      source_url: "https://instagram.com/watchme_creator",
      normalized_text: "A manual creator Instagram post for the socials feed.",
      normalized_urls: ["https://instagram.com/p/ig-feed-post-1"],
      media_urls_json: ["https://cdn.watchme.example/social-feed-image.jpg"],
      published_at: "2026-04-03T13:00:00.000Z",
      metadata_json: {
        source: "social-feed-check",
      },
    }, internalToken);

    const eventId = acceptedResponse?.event?.event_id;
    if (!eventId) {
      throw new Error("Expected an event id from social ingest.");
    }

    const ingestJob = await getJobByType(pool, "ingest_platform_event", eventId);
    if (!ingestJob) {
      throw new Error("Expected an ingest_platform_event job for the social event.");
    }
    await handleJob(ingestJob);

    const processJob = await getJobByType(pool, "process_social_event", eventId);
    if (!processJob) {
      throw new Error("Expected a process_social_event job for the social event.");
    }
    await handleJob(processJob);

    const dispatchJob = await getJobByType(pool, "dispatch_social_feed_post", eventId);
    if (!dispatchJob) {
      throw new Error("Expected a dispatch_social_feed_post job for the social event.");
    }
    await handleJob(dispatchJob);

    const eventResult = await pool.query(
      `
        SELECT event_id, processing_state
        FROM event_ingest
        WHERE event_id = $1
      `,
      [eventId]
    );
    const postResult = await pool.query(
      `
        SELECT guild_id, platform, session_key, status, discord_message_id
        FROM post_history
        WHERE guild_id = $1
          AND platform = 'instagram'
          AND session_key = $2
      `,
      [guildId, dispatchJob.payload_json.sessionKey]
    );

    const summary = {
      ok: true,
      acceptedResponse,
      ingestJobType: ingestJob.job_type,
      processJobType: processJob.job_type,
      dispatchJobType: dispatchJob.job_type,
      event: eventResult.rows[0] || null,
      postHistory: postResult.rows[0] || null,
      discordMessages: discordState.messages,
    };

    console.log(JSON.stringify(summary, null, 2));

    if (acceptedResponse.ingested !== true || acceptedResponse.enqueued !== true) {
      throw new Error("Expected accepted social event to be ingested and queued.");
    }

    if ((eventResult.rows[0] || {}).processing_state !== "processed") {
      throw new Error(`Expected social event state processed, found ${(eventResult.rows[0] || {}).processing_state}`);
    }

    const postHistory = postResult.rows[0] || null;
    if (!postHistory || postHistory.status !== "posted") {
      throw new Error("Expected one posted social feed history row.");
    }

    if (!postHistory.discord_message_id) {
      throw new Error("Expected social feed post history to store a Discord message id.");
    }

    if (discordState.messages.length !== 1) {
      throw new Error(`Expected 1 Discord social feed message, found ${discordState.messages.length}`);
    }

    const message = discordState.messages[0];
    if (message.channelId !== discordChannelId) {
      throw new Error(`Expected Discord message in ${discordChannelId}, found ${message.channelId}`);
    }

    const embed = Array.isArray(message.payload?.embeds) ? message.payload.embeds[0] || {} : {};
    if (embed.title !== "WatchMe Creator posted on Instagram") {
      throw new Error(`Unexpected social feed embed title ${embed.title}`);
    }

    if (embed.url !== "https://instagram.com/p/ig-feed-post-1") {
      throw new Error(`Unexpected social feed embed url ${embed.url}`);
    }
  } finally {
    process.env.INTERNAL_API_TOKEN = originalInternalToken;
    process.env.DISCORD_BOT_TOKEN = originalDiscordToken;
    process.env.DISCORD_API_BASE_URL = originalDiscordBaseUrl;

    try {
      await pool.query("DELETE FROM job_queue WHERE payload_json->>'sourceExternalId' = 'ig-feed-post-1'");
      await pool.query("DELETE FROM post_history WHERE guild_id = $1", [guildId]);
      await pool.query("DELETE FROM event_ingest WHERE source_external_id = 'ig-feed-post-1'");
      await pool.query("DELETE FROM pro_entitlements WHERE bound_guild_id = $1", [guildId]);
      await pool.query("DELETE FROM creator_social_connections WHERE discord_user_id = $1", [discordUserId]);
      await pool.query("DELETE FROM creator_access WHERE guild_id = $1 AND discord_user_id = $2", [guildId, discordUserId]);
      await pool.query("DELETE FROM creator_profiles WHERE guild_id = $1 AND discord_user_id = $2", [guildId, discordUserId]);
      await pool.query("DELETE FROM guild_config WHERE guild_id = $1", [guildId]);
      await pool.query("DELETE FROM users WHERE discord_user_id = $1", [discordUserId]);
      await pool.query("DELETE FROM guilds WHERE guild_id = $1", [guildId]);
    } finally {
      if (apiServer) {
        await new Promise((resolve) => apiServer.close(resolve));
      }
      if (discordServer) {
        await new Promise((resolve) => discordServer.close(resolve));
      }
      await pool.end().catch(() => null);
      await apiDb.closePool().catch(() => null);
      await workerDb.closePool().catch(() => null);
    }
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
