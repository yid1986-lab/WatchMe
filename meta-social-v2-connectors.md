const YOUTUBE_CHANNEL_ID_PATTERN = /^UC[a-zA-Z0-9_-]{10,}$/;

const resolveCache = new Map();

const RESOLVE_CACHE_MS = 24 * 60 * 60 * 1000;

function isYouTubeConfigured(config) {
  return Boolean(config.youtubeApiKey && config.youtubeWebhookBaseUrl);
}

function getYouTubeApiBaseUrl(config) {
  return String(config.youtubeApiBaseUrl || "https://www.googleapis.com/youtube/v3").trim();
}

function getYouTubeWebhookHubUrl(config) {
  return String(config.youtubeWebhookHubUrl || "https://pubsubhubbub.appspot.com/subscribe").trim();
}

function buildYouTubeSourceKey(channelId) {
  const normalized = String(channelId || "").trim();
  if (!normalized) {
    throw new Error("YouTube channel id is required.");
  }

  return `youtube:${normalized}`;
}

function normalizeYouTubeChannelUrl(channelId) {
  return `https://www.youtube.com/channel/${encodeURIComponent(String(channelId || "").trim())}`;
}

function buildYouTubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(String(videoId || "").trim())}`;
}

function buildYouTubeWebhookCallbackUrl(config) {
  const base = String(config.youtubeWebhookBaseUrl || "").trim();
  const path = String(config.youtubeWebhookPath || "/webhooks/youtube").trim() || "/webhooks/youtube";
  if (!base) {
    throw new Error("YOUTUBE_WEBHOOK_BASE_URL is not configured.");
  }

  return new URL(path.replace(/^\/?/, "/"), base.endsWith("/") ? base : `${base}/`).toString();
}

function buildYouTubeFeedTopic(channelId) {
  const normalized = String(channelId || "").trim();
  if (!normalized) {
    throw new Error("YouTube channel id is required.");
  }

  return `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${encodeURIComponent(normalized)}`;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripCdata(value) {
  return String(value || "")
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "");
}

function extractXmlTag(xml, tagName) {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = pattern.exec(String(xml || ""));
  return match ? decodeXml(stripCdata(match[1]).trim()) : null;
}

function extractXmlAttr(xml, tagName, attrName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*\\b${attrName}="([^"]+)"[^>]*>`, "i");
  const match = pattern.exec(String(xml || ""));
  return match ? decodeXml(match[1]) : null;
}

function toUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

function extractYouTubeChannelId(value) {
  let raw = String(value || "").trim();
  if (!raw) return null;

  if (/^youtube:/i.test(raw)) {
    raw = raw.slice("youtube:".length).trim();
  }

  if (YOUTUBE_CHANNEL_ID_PATTERN.test(raw)) {
    return raw;
  }

  const url = toUrl(raw);
  if (!url) return null;

  const host = url.hostname.toLowerCase();
  if (!host.includes("youtube.com") && !host.includes("youtu.be")) {
    return null;
  }

  const channelId = url.searchParams.get("channel_id");
  if (YOUTUBE_CHANNEL_ID_PATTERN.test(channelId || "")) {
    return channelId;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const channelIndex = parts.findIndex((part) => part.toLowerCase() === "channel");
  if (channelIndex !== -1 && YOUTUBE_CHANNEL_ID_PATTERN.test(parts[channelIndex + 1] || "")) {
    return parts[channelIndex + 1];
  }

  return null;
}

function parseYouTubeHandleFromUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (raw.startsWith("@") && raw.length > 1) {
    return raw.slice(1);
  }

  const url = toUrl(raw);
  if (!url || !url.hostname.toLowerCase().includes("youtube.com")) {
    return null;
  }

  const first = url.pathname.split("/").filter(Boolean)[0] || "";
  return first.startsWith("@") && first.length > 1 ? decodeURIComponent(first.slice(1)) : null;
}

function parseYouTubeUserFromUrl(value) {
  const url = toUrl(value);
  if (!url || !url.hostname.toLowerCase().includes("youtube.com")) {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const userIndex = parts.findIndex((part) => part.toLowerCase() === "user");
  return userIndex !== -1 && parts[userIndex + 1]
    ? decodeURIComponent(parts[userIndex + 1])
    : null;
}

function parseYouTubeCustomFromUrl(value) {
  const url = toUrl(value);
  if (!url || !url.hostname.toLowerCase().includes("youtube.com")) {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const customIndex = parts.findIndex((part) => part.toLowerCase() === "c");
  return customIndex !== -1 && parts[customIndex + 1]
    ? decodeURIComponent(parts[customIndex + 1])
    : null;
}

function parseFeedEntries(xml) {
  const raw = String(xml || "");
  const feedChannelId = extractXmlTag(raw, "yt:channelId");
  const matches = raw.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];

  return matches
    .map((entryXml) => {
      const videoId = extractXmlTag(entryXml, "yt:videoId");
      const channelId = extractXmlTag(entryXml, "yt:channelId") || feedChannelId;
      const title = extractXmlTag(entryXml, "title") || "";
      const url =
        extractXmlAttr(entryXml, "link", "href") ||
        (videoId ? buildYouTubeWatchUrl(videoId) : null);
      const channelTitle = extractXmlTag(entryXml, "name") || "";
      const published = extractXmlTag(entryXml, "published") || null;
      const updated = extractXmlTag(entryXml, "updated") || null;

      return {
        videoId: String(videoId || "").trim() || null,
        channelId: String(channelId || "").trim() || null,
        title,
        url,
        channelTitle,
        published,
        updated,
        thumbnailUrl: videoId
          ? `https://i.ytimg.com/vi/${encodeURIComponent(String(videoId).trim())}/hqdefault.jpg`
          : null,
      };
    })
    .filter((entry) => entry.videoId && entry.channelId);
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

async function youtubeApiRequest(config, path, searchParams = {}) {
  const url = new URL(path, `${getYouTubeApiBaseUrl(config).replace(/\/+$/, "")}/`);
  url.searchParams.set("key", config.youtubeApiKey);

  for (const [key, value] of Object.entries(searchParams || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, value);
  }

  return requestJson(url.toString());
}

async function resolveViaHandle(config, handle) {
  const data = await youtubeApiRequest(config, "channels", {
    part: "id",
    forHandle: handle,
    maxResults: "1",
  });

  return Array.isArray(data?.items) ? data.items[0]?.id || null : null;
}

async function resolveViaUsername(config, username) {
  const data = await youtubeApiRequest(config, "channels", {
    part: "id",
    forUsername: username,
    maxResults: "1",
  });

  return Array.isArray(data?.items) ? data.items[0]?.id || null : null;
}

async function resolveViaSearch(config, query) {
  const data = await youtubeApiRequest(config, "search", {
    part: "snippet",
    q: query,
    type: "channel",
    maxResults: "1",
  });

  return Array.isArray(data?.items) ? data.items[0]?.snippet?.channelId || null : null;
}

async function resolveChannelId(config, value) {
  if (!config.youtubeApiKey) {
    return null;
  }

  const rawValue = String(value || "").trim();
  const direct = extractYouTubeChannelId(value);
  if (direct) {
    return direct;
  }

  const cacheKey = rawValue;
  if (!cacheKey) {
    return null;
  }
  const cached = resolveCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.seenAt < RESOLVE_CACHE_MS) {
    return cached.channelId;
  }

  let resolved = null;
  const handle = parseYouTubeHandleFromUrl(value);
  const username = parseYouTubeUserFromUrl(value);
  const custom = parseYouTubeCustomFromUrl(value);

  if (handle) {
    resolved = await resolveViaHandle(config, handle).catch(() => null);
    if (!resolved) {
      resolved = await resolveViaSearch(config, `@${handle}`).catch(() => null);
    }
  } else if (username) {
    resolved = await resolveViaUsername(config, username).catch(() => null);
    if (!resolved) {
      resolved = await resolveViaSearch(config, username).catch(() => null);
    }
  } else if (custom) {
    resolved = await resolveViaSearch(config, custom).catch(() => null);
  } else {
    const url = toUrl(rawValue);
    const query =
      url
        ? url.pathname.split("/").filter(Boolean).pop() || rawValue
        : rawValue;
    resolved = await resolveViaSearch(config, query).catch(() => null);
  }

  resolveCache.set(cacheKey, {
    channelId: resolved,
    seenAt: now,
  });

  return resolved;
}

async function subscribeToChannel(config, channelId, mode = "subscribe") {
  const callback = buildYouTubeWebhookCallbackUrl(config);
  const topic = buildYouTubeFeedTopic(channelId);
  const leaseSeconds = Number(config.youtubeWebhookLeaseSeconds || 864000);
  const body = new URLSearchParams({
    "hub.callback": callback,
    "hub.mode": mode,
    "hub.topic": topic,
    "hub.verify": "async",
    "hub.lease_seconds": String(leaseSeconds),
  });

  await requestText(getYouTubeWebhookHubUrl(config), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  return {
    callback,
    topic,
    leaseSeconds,
  };
}

function isYouTubeLiveVideo(video = {}) {
  const liveState = String(video?.liveBroadcastContent || "").trim().toLowerCase();
  const startedAt = video?.actualStartTime || null;
  const endedAt = video?.actualEndTime || null;

  return liveState === "live" || Boolean(startedAt && !endedAt);
}

async function getVideoById(config, videoId) {
  const data = await youtubeApiRequest(config, "videos", {
    part: "snippet,liveStreamingDetails",
    id: videoId,
    maxResults: "1",
  });

  const item = Array.isArray(data?.items) ? data.items[0] || null : null;
  if (!item) {
    return null;
  }

  const snippet = item.snippet || {};
  const liveStreamingDetails = item.liveStreamingDetails || {};
  const thumbnails = snippet.thumbnails || {};
  const thumbnailUrl =
    thumbnails.maxres?.url ||
    thumbnails.standard?.url ||
    thumbnails.high?.url ||
    thumbnails.medium?.url ||
    thumbnails.default?.url ||
    null;

  const video = {
    videoId: item.id || String(videoId || "").trim() || null,
    channelId: snippet.channelId || null,
    channelTitle: snippet.channelTitle || null,
    title: snippet.title || "",
    liveBroadcastContent: snippet.liveBroadcastContent || null,
    actualStartTime: liveStreamingDetails.actualStartTime || null,
    actualEndTime: liveStreamingDetails.actualEndTime || null,
    thumbnailUrl,
    watchUrl: buildYouTubeWatchUrl(item.id || videoId),
  };

  return {
    ...video,
    isActiveLive: isYouTubeLiveVideo(video),
  };
}

module.exports = {
  buildYouTubeFeedTopic,
  buildYouTubeSourceKey,
  buildYouTubeWebhookCallbackUrl,
  extractYouTubeChannelId,
  getVideoById,
  isYouTubeConfigured,
  isYouTubeLiveVideo,
  normalizeYouTubeChannelUrl,
  parseFeedEntries,
  parseYouTubeCustomFromUrl,
  parseYouTubeHandleFromUrl,
  parseYouTubeUserFromUrl,
  resolveChannelId,
  subscribeToChannel,
};
