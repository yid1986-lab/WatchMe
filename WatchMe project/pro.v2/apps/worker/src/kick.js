const crypto = require("node:crypto");

const KICK_EVENT_TYPES = ["livestream.status.updated", "livestream.metadata.updated"];

let appToken = null;
let appTokenExpiresAt = 0;
let cachedPublicKey = null;
let cachedPublicKeyExpiresAt = 0;

function nowMs() {
  return Date.now();
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

function isKickConfigured(config) {
  return Boolean(
    config.kickClientId &&
      config.kickClientSecret &&
      config.kickWebhookBaseUrl
  );
}

function buildKickSourceKey(broadcasterId) {
  return `kick:${String(broadcasterId || "").trim()}`;
}

function extractKickBroadcasterId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw.startsWith("kick:")) return null;
  const next = raw.slice("kick:".length);
  return /^\d+$/.test(next) ? next : null;
}

function parseKickSlug(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  if (/^kick:/i.test(raw)) {
    const next = raw.slice("kick:".length).trim();
    return /^\d+$/.test(next) ? null : next.toLowerCase();
  }

  if (/^[a-z0-9][a-z0-9_-]{1,}$/i.test(raw) && !raw.includes(".")) {
    return raw.toLowerCase();
  }

  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withScheme);
    if (!/kick\.com$/i.test(url.hostname) && !/\.kick\.com$/i.test(url.hostname)) {
      return null;
    }

    const slug = url.pathname.split("/").filter(Boolean)[0];
    return slug ? slug.toLowerCase() : null;
  } catch {
    return null;
  }
}

function normalizeKickUrl(slug) {
  return slug ? `https://kick.com/${String(slug).trim().toLowerCase()}` : null;
}

function buildKickWebhookCallbackUrl(config) {
  const base = String(config.kickWebhookBaseUrl || "").trim();
  const path = String(config.kickWebhookPath || "/webhooks/kick").trim() || "/webhooks/kick";
  if (!base) {
    throw new Error("KICK_WEBHOOK_BASE_URL is not configured.");
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
    const message =
      data?.error?.message ||
      data?.message ||
      data?.error ||
      `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return data;
}

async function requestText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(10000),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  return text;
}

async function getAppAccessToken(config) {
  if (appToken && nowMs() < appTokenExpiresAt) {
    return appToken;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.kickClientId,
    client_secret: config.kickClientSecret,
  });

  const data = await requestJson(config.kickTokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  appToken = data.access_token || null;
  const expiresIn = Number(data.expires_in || 0);
  appTokenExpiresAt = nowMs() + Math.max(0, (expiresIn - 60) * 1000);

  if (!appToken) {
    throw new Error("Kick token response did not include an access token.");
  }

  return appToken;
}

async function kickRequest(config, path, { method = "GET", searchParams = null, body = null } = {}) {
  const token = await getAppAccessToken(config);
  const url = new URL(path.replace(/^\/?/, ""), `${String(config.kickApiBaseUrl || "").replace(/\/+$/, "")}/`);

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null || value === "") continue;

      if (Array.isArray(value)) {
        for (const item of value) {
          if (item === undefined || item === null || item === "") continue;
          url.searchParams.append(key, String(item));
        }
        continue;
      }

      url.searchParams.set(key, String(value));
    }
  }

  return requestJson(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function mapChannelPayload(payload = {}, fallbackSlug = null) {
  const stream = payload.stream || payload.livestream || {};
  const category = payload.category || stream.category || {};

  return {
    broadcasterId:
      payload.broadcaster_user_id !== undefined && payload.broadcaster_user_id !== null
        ? String(payload.broadcaster_user_id)
        : null,
    slug: String(payload.slug || fallbackSlug || "").trim().toLowerCase() || null,
    name: payload.username || payload.slug || fallbackSlug || "Kick creator",
    title: payload.stream_title || stream.title || "",
    categoryName: category.name || "",
    isLive:
      stream.is_live !== undefined
        ? Boolean(stream.is_live)
        : Boolean(payload.is_live),
    viewerCount: Number.isFinite(Number(stream.viewer_count))
      ? Number(stream.viewer_count)
      : null,
    startedAt: stream.start_time || payload.started_at || null,
    thumbnailUrl: stream.thumbnail || payload.banner_picture || null,
    profilePicture: payload.profile_picture || null,
    sourceUrl: normalizeKickUrl(payload.slug || fallbackSlug),
  };
}

async function lookupKickChannel(config, input) {
  const broadcasterId =
    /^\d+$/.test(String(input || "").trim())
      ? String(input).trim()
      : extractKickBroadcasterId(input);
  const slug = parseKickSlug(input);

  if (!broadcasterId && !slug) {
    return null;
  }

  const data = await kickRequest(config, "channels", {
    searchParams: broadcasterId
      ? { broadcaster_user_id: broadcasterId }
      : { slug },
  });

  const item = Array.isArray(data?.data) ? data.data[0] || null : data?.data || null;
  return item ? mapChannelPayload(item, slug) : null;
}

function mapLivestreamPayload(payload = {}, channel = {}) {
  const category = payload.category || {};
  return {
    broadcasterId:
      payload.broadcaster_user_id !== undefined && payload.broadcaster_user_id !== null
        ? String(payload.broadcaster_user_id)
        : channel.broadcasterId || null,
    slug: String(payload.slug || channel.slug || "").trim().toLowerCase() || null,
    title: payload.stream_title || payload.title || channel.title || "",
    categoryName: category.name || channel.categoryName || "",
    viewerCount: Number.isFinite(Number(payload.viewer_count))
      ? Number(payload.viewer_count)
      : channel.viewerCount,
    startedAt: payload.started_at || channel.startedAt || null,
    thumbnailUrl: payload.thumbnail || channel.thumbnailUrl || null,
    sourceUrl: normalizeKickUrl(payload.slug || channel.slug),
    isLive: true,
  };
}

async function getLivestreamByBroadcasterId(config, broadcasterId) {
  const data = await kickRequest(config, "livestreams", {
    searchParams: {
      broadcaster_user_id: broadcasterId,
      limit: "1",
    },
  });

  const item = Array.isArray(data?.data) ? data.data[0] || null : data?.data || null;
  return item ? mapLivestreamPayload(item) : null;
}

async function listEventSubscriptions(config, broadcasterId) {
  const data = await kickRequest(config, "events/subscriptions", {
    searchParams: {
      broadcaster_user_id: broadcasterId,
    },
  });

  return Array.isArray(data?.data) ? data.data : [];
}

async function deleteEventSubscriptions(config, ids = []) {
  if (!ids.length) {
    return;
  }

  const token = await getAppAccessToken(config);
  const url = new URL("events/subscriptions", `${String(config.kickApiBaseUrl || "").replace(/\/+$/, "")}/`);
  for (const id of ids) {
    url.searchParams.append("id", String(id));
  }

  const response = await fetch(url.toString(), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok && response.status !== 204) {
    const text = await response.text();
    throw new Error(text || `Failed deleting Kick subscriptions ${ids.join(", ")}`);
  }
}

async function createEventSubscriptions(config, broadcasterId, eventNames = []) {
  const data = await kickRequest(config, "events/subscriptions", {
    method: "POST",
    body: {
      broadcaster_user_id: Number(broadcasterId),
      events: eventNames.map((name) => ({
        name,
        version: 1,
      })),
      method: "webhook",
    },
  });

  return Array.isArray(data?.data) ? data.data : [];
}

function mapProviderSubscriptions(subscriptions = []) {
  return Object.fromEntries(
    subscriptions.map((subscription) => [
      subscription.event || subscription.name,
      {
        id: subscription.id || subscription.subscription_id || null,
        status: subscription.status || "active",
        version: subscription.version || 1,
      },
    ])
  );
}

async function ensureLivestreamSubscriptions(config, broadcasterId) {
  const existing = await listEventSubscriptions(config, broadcasterId);
  const next = {};
  const duplicateIds = [];
  const missingNames = [];

  for (const eventName of KICK_EVENT_TYPES) {
    const matches = existing.filter((subscription) => {
      return String(subscription?.event || "").trim().toLowerCase() === eventName;
    });

    if (matches.length) {
      next[eventName] = {
        id: matches[0].id || matches[0].subscription_id || null,
        status: matches[0].status || "active",
        version: matches[0].version || 1,
      };

      for (const duplicate of matches.slice(1)) {
        if (duplicate?.id || duplicate?.subscription_id) {
          duplicateIds.push(duplicate.id || duplicate.subscription_id);
        }
      }

      continue;
    }

    missingNames.push(eventName);
  }

  if (duplicateIds.length) {
    await deleteEventSubscriptions(config, duplicateIds);
  }

  if (missingNames.length) {
    const created = await createEventSubscriptions(config, broadcasterId, missingNames);
    Object.assign(next, mapProviderSubscriptions(created));
  }

  return next;
}

async function getKickPublicKey(config) {
  if (cachedPublicKey && nowMs() < cachedPublicKeyExpiresAt) {
    return cachedPublicKey;
  }

  const data = await requestJson(config.kickPublicKeyUrl);
  cachedPublicKey = data?.data?.public_key || null;
  cachedPublicKeyExpiresAt = nowMs() + 60 * 60 * 1000;

  if (!cachedPublicKey) {
    throw new Error("Kick public key response did not include a public key.");
  }

  return cachedPublicKey;
}

async function verifyKickWebhookSignature(headers, rawBody, config, publicKeyOverride = null) {
  const signature = getHeader(headers, "Kick-Event-Signature");
  const messageId = getHeader(headers, "Kick-Event-Message-Id");
  const timestamp = getHeader(headers, "Kick-Event-Message-Timestamp");

  if (!signature || !messageId || !timestamp) {
    return false;
  }

  const publicKey = publicKeyOverride || await getKickPublicKey(config);
  const signedPayload = Buffer.concat([
    Buffer.from(messageId, "utf8"),
    Buffer.from(".", "utf8"),
    Buffer.from(timestamp, "utf8"),
    Buffer.from(".", "utf8"),
    rawBody,
  ]);

  try {
    return crypto.verify(
      "RSA-SHA256",
      signedPayload,
      publicKey,
      Buffer.from(signature, "base64")
    );
  } catch {
    return false;
  }
}

module.exports = {
  buildKickSourceKey,
  buildKickWebhookCallbackUrl,
  ensureLivestreamSubscriptions,
  extractKickBroadcasterId,
  getAppAccessToken,
  getHeader,
  getKickPublicKey,
  getLivestreamByBroadcasterId,
  isKickConfigured,
  lookupKickChannel,
  normalizeKickUrl,
  parseKickSlug,
  verifyKickWebhookSignature,
};
