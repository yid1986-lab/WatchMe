const http = require("node:http");
const { buildLiveSessionKey } = require("../../../packages/shared/src");
const { getWorkerConfig } = require("./config");
const { log } = require("./logger");
const { getRuntimeSnapshot } = require("./runtime");
const {
  enqueuePlatformEventJob,
  enqueuePlatformSubscriptionRenewalJob,
  ingestPlatformEvent,
  updatePlatformSubscriptionsByTopic,
} = require("./store");
const {
  buildTwitchSourceKey,
  getHeader,
  isTwitchConfigured,
  verifyEventSubSignature,
} = require("./twitch");
const {
  buildYouTubeSourceKey,
  buildYouTubeWebhookCallbackUrl,
  extractYouTubeChannelId,
  isYouTubeConfigured,
  parseFeedEntries,
} = require("./youtube");
const {
  buildKickSourceKey,
  getHeader: getKickHeader,
  isKickConfigured,
  verifyKickWebhookSignature,
} = require("./kick");

let server = null;
const INTERNAL_BEARER_PREFIX = "bearer ";

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(res, statusCode, body) {
  const payload = String(body || "");
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function getInternalAuthToken(req) {
  const bearer = String(req.headers.authorization || "").trim();
  if (bearer.toLowerCase().startsWith(INTERNAL_BEARER_PREFIX)) {
    return bearer.slice(INTERNAL_BEARER_PREFIX.length).trim();
  }
  return String(req.headers["x-internal-token"] || "").trim();
}

function isInternalAuthorized(req, config) {
  if (!config.internalApiToken) {
    return String(config.nodeEnv || "").trim().toLowerCase() !== "production";
  }
  return getInternalAuthToken(req) === config.internalApiToken;
}

function buildConnectorSnapshot(config) {
  return {
    twitch: {
      configured: isTwitchConfigured(config),
      webhookPath: config.twitchWebhookPath,
      queuesEnabled: config.queues.includes("platform_subscription") || config.queues.includes("platform_ingest"),
    },
    youtube: {
      configured: isYouTubeConfigured(config),
      webhookPath: config.youtubeWebhookPath,
      queuesEnabled: config.queues.includes("platform_subscription") || config.queues.includes("platform_ingest"),
    },
    kick: {
      configured: isKickConfigured(config),
      webhookPath: config.kickWebhookPath,
      queuesEnabled: config.queues.includes("platform_subscription") || config.queues.includes("platform_ingest"),
    },
  };
}

function isYouTubeWebhookPath(pathname, config) {
  const allowedPaths = new Set([
    String(config.youtubeWebhookPath || "").trim(),
    ...(Array.isArray(config.youtubeWebhookLegacyPaths) ? config.youtubeWebhookLegacyPaths : []),
  ].filter(Boolean));
  return allowedPaths.has(String(pathname || "").trim());
}

async function handleTwitchWebhookNotification(headers, body) {
  const messageId = getHeader(headers, "Twitch-Eventsub-Message-Id");
  const eventType = body?.subscription?.type || "unknown";
  const broadcasterId = body?.event?.broadcaster_user_id || body?.subscription?.condition?.broadcaster_user_id || null;

  if (!broadcasterId) {
    throw new Error("Missing broadcaster_user_id in Twitch webhook payload.");
  }

  const sourceKey = buildTwitchSourceKey(broadcasterId);
  const sourceCreatedAt = body?.event?.started_at || body?.subscription?.created_at || null;

  const event = await ingestPlatformEvent({
    platform: "twitch",
    eventType,
    sourceKey,
    sourceExternalId: broadcasterId,
    sourceCreatedAt,
    providerEventId: messageId,
    dedupeKey: `twitch:message:${messageId}`,
    payload: {
      providerMessageId: messageId,
      subscription: body.subscription || {},
      event: body.event || {},
    },
  });

  await enqueuePlatformEventJob({
    eventId: event.event_id,
    platform: event.platform,
    eventType: event.event_type,
    sourceKey: event.source_key,
    sourceExternalId: event.source_external_id,
    sourceCreatedAt: event.source_created_at,
    sessionKey: buildLiveSessionKey({
      platform: event.platform,
      sourceKey: event.source_key,
      sourceExternalId: event.source_external_id,
      sourceCreatedAt: event.source_created_at,
      providerEventId: messageId,
      eventType: event.event_type,
    }),
  });

  log("info", "twitch", `Accepted Twitch webhook message ${messageId} for ${sourceKey}`);
}

async function handleTwitchWebhookVerification(body) {
  const eventType = body?.subscription?.type || "unknown";
  const callback = body?.subscription?.transport?.callback || null;
  const broadcasterId = body?.subscription?.condition?.broadcaster_user_id || null;
  const subscriptionId = body?.subscription?.id || null;

  if (!broadcasterId) {
    return;
  }

  const sourceKey = buildTwitchSourceKey(broadcasterId);
  await updatePlatformSubscriptionsByTopic("twitch", sourceKey, {
    status: "active",
    callbackUrl: callback,
    lastVerifiedAt: new Date().toISOString(),
    metadataJson: {
      providerSubscriptions: {
        [eventType]: {
          id: subscriptionId,
          status: body?.subscription?.status || "enabled",
        },
      },
    },
  });
}

async function handleTwitchWebhookRevocation(body) {
  const eventType = body?.subscription?.type || "unknown";
  const broadcasterId = body?.subscription?.condition?.broadcaster_user_id || null;

  if (!broadcasterId) {
    return;
  }

  const sourceKey = buildTwitchSourceKey(broadcasterId);
  const affected = await updatePlatformSubscriptionsByTopic("twitch", sourceKey, {
    status: "revoked",
    metadataJson: {
      revocation: {
        eventType,
        status: body?.subscription?.status || "revoked",
        reason: body?.subscription?.status || "revoked",
        seenAt: new Date().toISOString(),
      },
    },
  });

  for (const row of affected) {
    const metadata = row.metadata_json || {};
    const scope = String(metadata.scope || "").trim().toLowerCase() === "lite"
      ? "lite"
      : (row.guild_id ? "guild" : "creator");

    await enqueuePlatformSubscriptionRenewalJob(
      {
        subscriptionId: row.subscription_id,
        platform: row.platform,
        topicKey: row.topic_key,
        guildId: row.guild_id || row.creator_guild_id || null,
        discordUserId: row.creator_discord_user_id || null,
        scope,
        metadata,
      },
      new Date(Date.now() + 60 * 1000).toISOString()
    );
  }
}

async function handleTwitchWebhook(req, res) {
  const config = getWorkerConfig();
  if (!config.twitchWebhookSecret) {
    log("error", "twitch", "Rejected Twitch webhook: secret is not configured");
    return sendJson(res, 503, { error: "Twitch webhook secret is not configured" });
  }
  const rawBody = await readRawBody(req);

  if (!verifyEventSubSignature(req.headers, rawBody, config.twitchWebhookSecret)) {
    log("warn", "twitch", "Rejected Twitch webhook: invalid signature");
    return sendJson(res, 403, { error: "Invalid signature" });
  }

  let body;
  try {
    body = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON body" });
  }

  const messageType = getHeader(req.headers, "Twitch-Eventsub-Message-Type").toLowerCase();

  if (messageType === "webhook_callback_verification") {
    try {
      await handleTwitchWebhookVerification(body);
    } catch (error) {
      log("error", "twitch", `Verification bookkeeping failed: ${error?.message || error}`);
    }
    return sendText(res, 200, body?.challenge || "");
  }

  if (messageType === "notification") {
    sendJson(res, 202, { ok: true });
    setImmediate(() => {
      handleTwitchWebhookNotification(req.headers, body).catch((error) => {
        log("error", "twitch", `Notification ingest failed: ${error?.message || error}`);
      });
    });
    return;
  }

  if (messageType === "revocation") {
    sendJson(res, 202, { ok: true });
    setImmediate(() => {
      handleTwitchWebhookRevocation(body).catch((error) => {
        log("error", "twitch", `Revocation handling failed: ${error?.message || error}`);
      });
    });
    return;
  }

  return sendJson(res, 200, { ok: true, ignored: true });
}

async function handleYouTubeWebhookVerification(url, res) {
  const config = getWorkerConfig();
  const mode = String(url.searchParams.get("hub.mode") || "").trim().toLowerCase();
  const topic = String(url.searchParams.get("hub.topic") || "").trim();
  const challenge = String(url.searchParams.get("hub.challenge") || "");
  const leaseSeconds = Number(url.searchParams.get("hub.lease_seconds") || config.youtubeWebhookLeaseSeconds || 0);
  const denialReason = String(url.searchParams.get("hub.reason") || "").trim() || null;
  const channelId = extractYouTubeChannelId(topic);

  if (!mode) {
    return sendJson(res, 400, { error: "Missing hub.mode" });
  }

  if (mode === "denied") {
    if (channelId) {
      const affected = await updatePlatformSubscriptionsByTopic("youtube", buildYouTubeSourceKey(channelId), {
        status: "revoked",
        lastVerifiedAt: new Date().toISOString(),
        metadataJson: {
          channelId,
          hub: {
            mode,
            topic,
            reason: denialReason,
            seenAt: new Date().toISOString(),
          },
        },
      });

      for (const row of affected) {
        const metadata = row.metadata_json || {};
        const scope = String(metadata.scope || "").trim().toLowerCase() === "lite"
          ? "lite"
          : (row.guild_id ? "guild" : "creator");

        await enqueuePlatformSubscriptionRenewalJob(
          {
            subscriptionId: row.subscription_id,
            platform: row.platform,
            topicKey: row.topic_key,
            guildId: row.guild_id || row.creator_guild_id || null,
            discordUserId: row.creator_discord_user_id || null,
            scope,
            metadata,
          },
          new Date(Date.now() + 5 * 60 * 1000).toISOString()
        );
      }
    }

    return sendJson(res, 202, { ok: true, ignored: true });
  }

  if (!challenge || !channelId) {
    return sendJson(res, 400, { error: "Invalid YouTube verification payload" });
  }

  const leaseExpiresAt =
    Number.isFinite(leaseSeconds) && leaseSeconds > 0
      ? new Date(Date.now() + leaseSeconds * 1000).toISOString()
      : null;

  await updatePlatformSubscriptionsByTopic("youtube", buildYouTubeSourceKey(channelId), {
    status: mode === "unsubscribe" ? "disabled" : "active",
    callbackUrl: buildYouTubeWebhookCallbackUrl(config),
    leaseExpiresAt,
    lastVerifiedAt: new Date().toISOString(),
    metadataJson: {
      channelId,
      hub: {
        mode,
        topic,
        leaseSeconds: Number.isFinite(leaseSeconds) ? leaseSeconds : null,
        verifiedAt: new Date().toISOString(),
      },
    },
  });

  return sendText(res, 200, challenge);
}

async function handleYouTubeWebhookNotification(rawBody) {
  const rawXml = rawBody.toString("utf8");
  const entries = parseFeedEntries(rawXml);

  if (!entries.length) {
    log("info", "youtube", "Accepted YouTube webhook with no feed entries");
    return;
  }

  for (const entry of entries) {
    const sourceKey = buildYouTubeSourceKey(entry.channelId);
    const sourceCreatedAt = entry.updated || entry.published || null;
    const providerEventId = [entry.channelId, entry.videoId, sourceCreatedAt]
      .filter(Boolean)
      .join(":");

    const event = await ingestPlatformEvent({
      platform: "youtube",
      eventType: "video.published",
      sourceKey,
      sourceExternalId: entry.videoId,
      sourceCreatedAt,
      providerEventId,
      payload: {
        entry,
      },
    });

    await enqueuePlatformEventJob({
      eventId: event.event_id,
      platform: event.platform,
      eventType: event.event_type,
      sourceKey: event.source_key,
      sourceExternalId: event.source_external_id,
      sourceCreatedAt: event.source_created_at,
      sessionKey: `youtube:${entry.channelId}:${entry.videoId}`,
    });
  }

  log("info", "youtube", `Accepted YouTube webhook with ${entries.length} feed entr${entries.length === 1 ? "y" : "ies"}`);
}

async function handleYouTubeWebhook(req, res) {
  if (req.method === "GET") {
    return handleYouTubeWebhookVerification(new URL(req.url, "http://127.0.0.1"), res);
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const rawBody = await readRawBody(req);
  sendJson(res, 202, { ok: true });

  setImmediate(() => {
    handleYouTubeWebhookNotification(rawBody).catch((error) => {
      log("error", "youtube", `Notification ingest failed: ${error?.message || error}`);
    });
  });
}

async function handleKickWebhookNotification(headers, body) {
  const messageId = getKickHeader(headers, "Kick-Event-Message-Id");
  const eventType = getKickHeader(headers, "Kick-Event-Type").toLowerCase() || "unknown";
  const broadcasterId = body?.broadcaster?.user_id ? String(body.broadcaster.user_id) : null;

  if (!broadcasterId) {
    throw new Error("Missing broadcaster.user_id in Kick webhook payload.");
  }

  const sourceKey = buildKickSourceKey(broadcasterId);
  const sourceCreatedAt =
    body?.started_at ||
    body?.ended_at ||
    body?.created_at ||
    null;

  const event = await ingestPlatformEvent({
    platform: "kick",
    eventType,
    sourceKey,
    sourceExternalId: broadcasterId,
    sourceCreatedAt,
    providerEventId: messageId,
    dedupeKey: `kick:message:${messageId}`,
    payload: {
      providerMessageId: messageId,
      event: body || {},
    },
  });

  await enqueuePlatformEventJob({
    eventId: event.event_id,
    platform: event.platform,
    eventType: event.event_type,
    sourceKey: event.source_key,
    sourceExternalId: event.source_external_id,
    sourceCreatedAt: event.source_created_at,
    sessionKey: buildLiveSessionKey({
      platform: event.platform,
      sourceKey: event.source_key,
      sourceExternalId: event.source_external_id,
      sourceCreatedAt: event.source_created_at,
      providerEventId: messageId,
      eventType: event.event_type,
    }),
  });

  log("info", "kick", `Accepted Kick webhook message ${messageId} for ${sourceKey}`);
}

async function handleKickWebhook(req, res) {
  const config = getWorkerConfig();
  const rawBody = await readRawBody(req);

  if (!(await verifyKickWebhookSignature(req.headers, rawBody, config))) {
    log("warn", "kick", "Rejected Kick webhook: invalid signature");
    return sendJson(res, 403, { error: "Invalid signature" });
  }

  let body;
  try {
    body = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {};
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON body" });
  }

  sendJson(res, 202, { ok: true });
  setImmediate(() => {
    handleKickWebhookNotification(req.headers, body).catch((error) => {
      log("error", "kick", `Notification ingest failed: ${error?.message || error}`);
    });
  });
}

function createWorkerServer() {
  const config = getWorkerConfig();

  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "watchme-v2-worker",
      });
    }

    if (req.method === "GET" && url.pathname === "/ops/runtime") {
      if (!isInternalAuthorized(req, config)) {
        return sendJson(res, 401, { error: "Unauthorized" });
      }

      return sendJson(res, 200, {
        ok: true,
        service: "watchme-v2-worker",
        runtime: getRuntimeSnapshot(),
        connectors: buildConnectorSnapshot(config),
        queues: config.queues,
        pollIntervalMs: config.pollIntervalMs,
        batchSize: config.batchSize,
        concurrency: config.concurrency,
        checkedAt: new Date().toISOString(),
      });
    }

    if (req.method === "POST" && url.pathname === config.twitchWebhookPath) {
      handleTwitchWebhook(req, res).catch((error) => {
        log("error", "server", `Twitch webhook handler failed: ${error?.message || error}`);
        if (!res.headersSent) {
          sendJson(res, 500, { error: "Internal server error" });
        }
      });
      return;
    }

    if (
      (req.method === "GET" || req.method === "POST") &&
      isYouTubeWebhookPath(url.pathname, config)
    ) {
      handleYouTubeWebhook(req, res).catch((error) => {
        log("error", "server", `YouTube webhook handler failed: ${error?.message || error}`);
        if (!res.headersSent) {
          sendJson(res, 500, { error: "Internal server error" });
        }
      });
      return;
    }

    if (req.method === "POST" && url.pathname === config.kickWebhookPath) {
      handleKickWebhook(req, res).catch((error) => {
        log("error", "server", `Kick webhook handler failed: ${error?.message || error}`);
        if (!res.headersSent) {
          sendJson(res, 500, { error: "Internal server error" });
        }
      });
      return;
    }

    return sendJson(res, 404, { error: "Not found" });
  });
}

function startServer() {
  const config = getWorkerConfig();
  if (server) return server;

  server = createWorkerServer();
  server.listen(config.port, () => {
    log("info", "server", `Worker server listening on ${config.port}`);
  });

  return server;
}

function stopServer() {
  if (!server) return;
  server.close();
  server = null;
}

module.exports = {
  startServer,
  stopServer,
};
