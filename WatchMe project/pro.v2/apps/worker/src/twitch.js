const crypto = require("node:crypto");

const TWITCH_SUBSCRIPTION_TYPES = ["stream.online", "stream.offline"];

let appToken = null;
let appTokenExpiresAt = 0;

function nowMs() {
  return Date.now();
}

function isTwitchConfigured(config) {
  return Boolean(
    config.twitchClientId &&
      config.twitchClientSecret &&
      config.twitchWebhookBaseUrl &&
      config.twitchWebhookSecret
  );
}

function getTwitchAuthUrl(config) {
  return String(config.twitchAuthUrl || "https://id.twitch.tv/oauth2/token").trim();
}

function getTwitchApiBaseUrl(config) {
  return String(config.twitchApiBaseUrl || "https://api.twitch.tv/helix").trim();
}

function buildTwitchSourceKey(broadcasterId) {
  return `twitch:${String(broadcasterId || "").trim()}`;
}

function extractTwitchBroadcasterId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw.startsWith("twitch:")) return null;
  const next = raw.slice("twitch:".length);
  return /^\d+$/.test(next) ? next : null;
}

function parseTwitchLogin(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (/^twitch:/i.test(raw)) {
    const next = raw.slice("twitch:".length).trim();
    return /^\d+$/.test(next) ? null : next.toLowerCase();
  }

  try {
    const url = new URL(raw);
    if (!url.hostname.toLowerCase().includes("twitch.tv")) return null;
    const first = url.pathname.split("/").filter(Boolean)[0];
    return first ? first.toLowerCase() : null;
  } catch {
    return /^[a-z0-9_]+$/i.test(raw) ? raw.toLowerCase() : null;
  }
}

function normalizeTwitchUrl(login) {
  return `https://www.twitch.tv/${String(login || "").trim().toLowerCase()}`;
}

function buildWebhookCallbackUrl(config) {
  const base = String(config.twitchWebhookBaseUrl || "").trim();
  const path = String(config.twitchWebhookPath || "/webhooks/twitch").trim() || "/webhooks/twitch";
  if (!base) {
    throw new Error("TWITCH_WEBHOOK_BASE_URL is not configured.");
  }

  return new URL(path.replace(/^\/?/, "/"), base.endsWith("/") ? base : `${base}/`).toString();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(10000),
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
    const message = data?.message || data?.error || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return data;
}

async function getAppAccessToken(config) {
  if (appToken && nowMs() < appTokenExpiresAt) {
    return appToken;
  }

  const params = new URLSearchParams({
    client_id: config.twitchClientId,
    client_secret: config.twitchClientSecret,
    grant_type: "client_credentials",
  });

  const authUrl = new URL(getTwitchAuthUrl(config));
  for (const [key, value] of params.entries()) {
    authUrl.searchParams.set(key, value);
  }

  const data = await requestJson(authUrl.toString(), {
    method: "POST",
  });

  appToken = data.access_token;
  const expiresIn = Number(data.expires_in || 0);
  appTokenExpiresAt = nowMs() + Math.max(0, (expiresIn - 60) * 1000);
  return appToken;
}

async function twitchRequest(config, path, { method = "GET", searchParams = null, body = null } = {}) {
  const token = await getAppAccessToken(config);
  const url = new URL(path, `${getTwitchApiBaseUrl(config).replace(/\/+$/, "")}/`);

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, value);
    }
  }

  return requestJson(url.toString(), {
    method,
    headers: {
      "Client-ID": config.twitchClientId,
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function lookupUserByLogin(config, login) {
  const data = await twitchRequest(config, "users", {
    searchParams: { login },
  });

  const user = Array.isArray(data?.data) ? data.data[0] : null;
  if (!user) return null;

  return {
    id: user.id,
    login: user.login,
    displayName: user.display_name,
    profileImageUrl: user.profile_image_url || null,
    url: normalizeTwitchUrl(user.login),
  };
}

async function getStreamInfo(config, broadcasterId) {
  const data = await twitchRequest(config, "streams", {
    searchParams: { user_id: broadcasterId },
  });

  const stream = Array.isArray(data?.data) ? data.data[0] : null;
  if (!stream) return null;

  return {
    id: stream.id || null,
    title: stream.title || "",
    game_name: stream.game_name || "",
    viewer_count: Number.isFinite(Number(stream.viewer_count)) ? Number(stream.viewer_count) : null,
    started_at: stream.started_at || null,
    broadcaster_user_id: stream.user_id || broadcasterId || null,
    broadcaster_user_login: stream.user_login || null,
    broadcaster_user_name: stream.user_name || null,
    thumbnail_url: stream.thumbnail_url
      ? stream.thumbnail_url.replace("{width}", "1280").replace("{height}", "720")
      : null,
  };
}

async function listEventSubSubscriptions(config) {
  const subscriptions = [];
  let cursor = null;

  do {
    const data = await twitchRequest(config, "eventsub/subscriptions", {
      searchParams: {
        first: "100",
        ...(cursor ? { after: cursor } : {}),
      },
    });

    if (Array.isArray(data?.data)) {
      subscriptions.push(...data.data);
    }

    cursor = data?.pagination?.cursor || null;
  } while (cursor);

  return subscriptions;
}

async function deleteEventSubSubscription(config, id) {
  const token = await getAppAccessToken(config);
  const url = new URL("eventsub/subscriptions", `${getTwitchApiBaseUrl(config).replace(/\/+$/, "")}/`);
  url.searchParams.set("id", id);

  const response = await fetch(url.toString(), {
    method: "DELETE",
    headers: {
      "Client-ID": config.twitchClientId,
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed deleting subscription ${id}`);
  }
}

async function createStreamSubscription(config, type, broadcasterId) {
  const callback = buildWebhookCallbackUrl(config);
  const data = await twitchRequest(config, "eventsub/subscriptions", {
    method: "POST",
    body: {
      type,
      version: "1",
      condition: {
        broadcaster_user_id: String(broadcasterId),
      },
      transport: {
        method: "webhook",
        callback,
        secret: config.twitchWebhookSecret,
      },
    },
  });

  return Array.isArray(data?.data) ? data.data[0] || null : null;
}

function isUsableSubscription(subscription) {
  return ["enabled", "webhook_callback_verification_pending"].includes(
    String(subscription?.status || "").toLowerCase()
  );
}

async function deleteSubscriptionsQuietly(config, subscriptions = []) {
  const deleted = [];

  for (const subscription of subscriptions) {
    if (!subscription?.id) continue;
    await deleteEventSubSubscription(config, subscription.id);
    deleted.push(subscription.id);
  }

  return deleted;
}

async function ensureStreamSubscriptions(config, broadcasterId) {
  const callback = buildWebhookCallbackUrl(config);
  const allSubscriptions = await listEventSubSubscriptions(config);
  const next = {};

  for (const type of TWITCH_SUBSCRIPTION_TYPES) {
    const matches = allSubscriptions.filter((subscription) => {
      return (
        subscription?.type === type &&
        String(subscription?.condition?.broadcaster_user_id || "") === String(broadcasterId) &&
        String(subscription?.transport?.callback || "") === String(callback)
      );
    });

    const usable = matches.find(isUsableSubscription);
    if (usable) {
      next[type] = usable;
      continue;
    }

    await deleteSubscriptionsQuietly(config, matches).catch(() => null);

    if (config.twitchPruneConflictingSubscriptions) {
      const conflicting = allSubscriptions.filter((subscription) => {
        return (
          subscription?.type === type &&
          String(subscription?.condition?.broadcaster_user_id || "") === String(broadcasterId) &&
          String(subscription?.transport?.callback || "") !== String(callback) &&
          isUsableSubscription(subscription)
        );
      });

      await deleteSubscriptionsQuietly(config, conflicting);
    }

    const created = await createStreamSubscription(config, type, broadcasterId);
    if (!created?.id) {
      throw new Error(`Twitch did not return a subscription id for ${type}`);
    }

    next[type] = created;
  }

  return next;
}

function getHeader(headers, name) {
  const expected = String(name || "").toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key || "").toLowerCase() === expected) {
      return Array.isArray(value) ? String(value[0] || "") : String(value || "");
    }
  }
  return "";
}

function verifyEventSubSignature(headers, rawBody, secret) {
  if (!secret) return false;

  const messageId = getHeader(headers, "Twitch-Eventsub-Message-Id");
  const timestamp = getHeader(headers, "Twitch-Eventsub-Message-Timestamp");
  const theirSignature = getHeader(headers, "Twitch-Eventsub-Message-Signature");

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(messageId + timestamp);
  hmac.update(rawBody);
  const expected = `sha256=${hmac.digest("hex")}`;

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(theirSignature));
  } catch {
    return false;
  }
}

module.exports = {
  buildTwitchSourceKey,
  buildWebhookCallbackUrl,
  ensureStreamSubscriptions,
  extractTwitchBroadcasterId,
  getTwitchApiBaseUrl,
  getTwitchAuthUrl,
  getHeader,
  getStreamInfo,
  isTwitchConfigured,
  lookupUserByLogin,
  normalizeTwitchUrl,
  parseTwitchLogin,
  verifyEventSubSignature,
};
