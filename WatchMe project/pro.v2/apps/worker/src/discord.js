function normalizeImageUrl(value) {
  const text = String(value || "").trim();
  return /^https?:\/\//i.test(text) ? text : null;
}

function firstImageUrl(values = []) {
  for (const value of Array.isArray(values) ? values : [values]) {
    const normalized = normalizeImageUrl(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function titleCasePlatform(platform) {
  const normalized = String(platform || "").trim().toLowerCase();
  if (!normalized) return "Stream";
  if (normalized === "youtube") return "YouTube";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  return normalized
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeHandle(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  return `@${normalized.replace(/^@+/, "")}`;
}

function buildLiveDescription({ sourceUrl, categoryLabel, categoryName, broadcasterName }) {
  const lines = [];
  if (sourceUrl) {
    lines.push(sourceUrl);
  }
  if (categoryName) {
    lines.push(`${categoryLabel}: ${categoryName}`);
  }

  return lines.join("\n") || `${broadcasterName} is live now.`;
}

function buildAllowedMentions(payload = {}) {
  const mode = String(payload.mentionMode || "role").trim().toLowerCase();
  const allowed = { parse: [] };

  if ((mode === "role" || mode === "both") && payload.liveRoleId) {
    allowed.roles = [payload.liveRoleId];
  }

  if ((mode === "member" || mode === "both") && payload.creatorDiscordUserId) {
    allowed.users = [payload.creatorDiscordUserId];
  }

  return allowed;
}

function buildMentionContent(payload = {}) {
  const mode = String(payload.mentionMode || "role").trim().toLowerCase();
  const mentions = [];

  if ((mode === "member" || mode === "both") && payload.creatorDiscordUserId) {
    mentions.push(`<@${payload.creatorDiscordUserId}>`);
  }

  if ((mode === "role" || mode === "both") && payload.liveRoleId) {
    mentions.push(`<@&${payload.liveRoleId}>`);
  }

  return mentions.join(" ") || null;
}

function buildLiveMessagePayload(payload = {}) {
  const event = payload.payload || {};
  const platformLabel = titleCasePlatform(payload.platform);
  const broadcasterName =
    event.broadcaster_user_name ||
    event.name ||
    payload.brandName ||
    "Someone";
  const sourceUrl =
    event.source_url ||
    event.url ||
    (event.broadcaster_user_login
      ? `https://www.twitch.tv/${String(event.broadcaster_user_login).toLowerCase()}`
      : null);
  const previewImage =
    normalizeImageUrl(event.thumbnail_url) ||
    normalizeImageUrl(payload.previewImageUrl);
  const authorIcon = firstImageUrl([
    payload.brandLogoUrl,
    payload.creatorAvatarUrl,
    payload.guildIconUrl,
  ]);
  const footerText = String(payload.footerText || "").trim() || null;
  const streamTitle = String(event.title || "").trim();
  const categoryName = String(event.game_name || event.category_name || "").trim();
  const categoryLabel = platformLabel === "YouTube" ? "Category" : "Game";

  const fields = [];
  if (Number.isFinite(Number(event.viewer_count))) {
    fields.push({
      name: "Viewers",
      value: String(Number(event.viewer_count)),
      inline: true,
    });
  }

  const embed = {
    title: (streamTitle || `${broadcasterName} is live now`).slice(0, 256),
    color: 5793266,
    description: buildLiveDescription({
      sourceUrl,
      categoryLabel,
      categoryName,
      broadcasterName,
    }).slice(0, 4096),
    timestamp: event.started_at || payload.sourceCreatedAt || new Date().toISOString(),
    author: {
      name: `${broadcasterName} is LIVE on ${platformLabel}`.slice(0, 256),
      ...(authorIcon ? { icon_url: authorIcon } : {}),
    },
  };

  if (sourceUrl) {
    embed.url = sourceUrl;
  }
  if (fields.length) {
    embed.fields = fields;
  }
  if (previewImage) {
    embed.image = { url: previewImage };
  }
  if (footerText) {
    embed.footer = { text: footerText.slice(0, 2048) };
  }

  const message = {
    embeds: [embed],
    allowed_mentions: buildAllowedMentions(payload),
  };

  const content = buildMentionContent(payload);
  if (content) {
    message.content = content;
  }

  return message;
}

function buildSocialFeedMessagePayload(payload = {}) {
  const event = payload.payload || {};
  const platformLabel = titleCasePlatform(payload.platform);
  const creatorName =
    String(
      event.creator_display_name ||
      payload.creatorDisplayName ||
      event.external_account_name ||
      event.external_account_id ||
      "Creator"
    ).trim() || "Creator";
  const normalizedText = String(event.normalized_text || "").trim();
  const postUrl =
    String(
      event.external_post_url ||
      (Array.isArray(event.normalized_urls) ? event.normalized_urls[0] : "") ||
      event.source_url ||
      ""
    ).trim() || null;
  const previewImage = firstImageUrl([
    ...(Array.isArray(event.media_urls_json) ? event.media_urls_json : []),
    event.preview_image_url,
    payload.previewImageUrl,
  ]);
  const contentLabel = formatLabel(event.content_label || event.content_type) || null;
  const surfaceLabel = formatLabel(event.media_product_type) || null;
  const accountHandle = normalizeHandle(event.external_account_handle);
  const authorIcon = normalizeImageUrl(payload.brandLogoUrl);
  const footerText = String(payload.footerText || "").trim() || null;

  const embed = {
    title: `${creatorName} posted on ${platformLabel}`,
    color: 5793266,
    description:
      normalizedText ||
      `${creatorName} posted new${contentLabel ? ` ${contentLabel.toLowerCase()}` : ""} content on ${platformLabel}.`,
    timestamp: event.published_at || payload.sourceCreatedAt || new Date().toISOString(),
  };

  if (postUrl && /^https?:\/\//i.test(postUrl)) {
    embed.url = postUrl;
  }

  const fields = [];
  if (event.external_account_name || event.external_account_id) {
    fields.push({
      name: "Account",
      value: String(event.external_account_name || event.external_account_id).slice(0, 1024),
      inline: true,
    });
  }

  if (accountHandle) {
    fields.push({
      name: "Handle",
      value: accountHandle.slice(0, 1024),
      inline: true,
    });
  }

  if (contentLabel) {
    fields.push({
      name: "Type",
      value: contentLabel.slice(0, 1024),
      inline: true,
    });
  }

  if (surfaceLabel) {
    fields.push({
      name: "Surface",
      value: surfaceLabel.slice(0, 1024),
      inline: true,
    });
  }

  if (fields.length) {
    embed.fields = fields;
  }

  if (previewImage) {
    embed.image = { url: previewImage };
  }

  if (payload.brandName) {
    embed.author = {
      name: String(payload.brandName).slice(0, 256),
      ...(authorIcon ? { icon_url: authorIcon } : {}),
    };
  }

  if (footerText) {
    embed.footer = { text: footerText.slice(0, 2048) };
  }

  return {
    embeds: [embed],
    allowed_mentions: { parse: [] },
  };
}

function normalizeEmbedFields(fields = []) {
  return (Array.isArray(fields) ? fields : []).map((field) => ({
    name: String(field?.name || ""),
    value: String(field?.value || ""),
    inline: Boolean(field?.inline),
  }));
}

function buildMessageSignature(message = {}) {
  const embed = Array.isArray(message.embeds) ? message.embeds[0] || {} : {};

  return JSON.stringify({
    content: String(message.content || ""),
    title: String(embed?.title || ""),
    description: String(embed?.description || ""),
    url: String(embed?.url || ""),
    timestamp: String(embed?.timestamp || ""),
    color: Number(embed?.color || 0),
    imageUrl: String(embed?.image?.url || ""),
    authorName: String(embed?.author?.name || ""),
    footerText: String(embed?.footer?.text || ""),
    fields: normalizeEmbedFields(embed?.fields || []),
  });
}

function doesMessageMatchPayload(message = {}, payload = {}) {
  return buildMessageSignature(message) === buildMessageSignature(payload);
}

function buildDiscordApiUrl(path, apiBaseUrl) {
  const base = String(apiBaseUrl || "https://discord.com/api/v10").trim();
  return new URL(path.replace(/^\/+/, ""), base.endsWith("/") ? base : `${base}/`).toString();
}

function shouldRetryDiscordStatus(statusCode) {
  return [429, 500, 502, 503, 504].includes(Number(statusCode || 0));
}

function getDiscordRetryDelayMs(response, data = {}, attempt = 1, baseDelayMs = 1000) {
  const bodyRetry = Number(data?.retry_after);
  if (Number.isFinite(bodyRetry) && bodyRetry > 0) {
    return Math.ceil(bodyRetry * 1000);
  }

  const resetAfterHeader = Number(response?.headers?.get?.("x-ratelimit-reset-after") || 0);
  if (Number.isFinite(resetAfterHeader) && resetAfterHeader > 0) {
    return Math.ceil(resetAfterHeader * 1000);
  }

  const retryAfterHeader = Number(response?.headers?.get?.("retry-after") || 0);
  if (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0) {
    return Math.ceil(retryAfterHeader * 1000);
  }

  return Math.min(30000, Math.max(250, Number(baseDelayMs || 1000) * Math.pow(2, Math.max(0, attempt - 1))));
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestDiscord(path, token, init = {}, options = {}) {
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN or DISCORD_TOKEN is not configured.");
  }

  const maxRetries = Math.max(0, Number(options.maxRetries || 5));
  const baseDelayMs = Math.max(250, Number(options.baseRetryMs || 1000));

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    let response;
    try {
      response = await fetch(buildDiscordApiUrl(path, options.apiBaseUrl), {
        ...init,
        headers: {
          Authorization: `Bot ${token}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers || {}),
        },
        signal: init.signal || AbortSignal.timeout(10000),
      });
    } catch (error) {
      if (attempt <= maxRetries) {
        await sleep(getDiscordRetryDelayMs(null, {}, attempt, baseDelayMs));
        continue;
      }
      throw error;
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    }

    if (response.ok) {
      return data;
    }

    if (shouldRetryDiscordStatus(response.status) && attempt <= maxRetries) {
      await sleep(getDiscordRetryDelayMs(response, data, attempt, baseDelayMs));
      continue;
    }

    throw new Error(data?.message || `${response.status} ${response.statusText}`);
  }
}

async function listChannelMessages(channelId, token, options = {}) {
  const limit = Math.max(1, Math.min(100, Number(options.limit || 25)));
  return requestDiscord(`/channels/${encodeURIComponent(channelId)}/messages?limit=${limit}`, token, {
    method: "GET",
  }, options);
}

async function sendChannelMessage(channelId, token, payload, options = {}) {
  return requestDiscord(`/channels/${encodeURIComponent(channelId)}/messages`, token, {
    method: "POST",
    body: JSON.stringify(payload),
  }, options);
}

async function deleteChannelMessage(channelId, messageId, token, options = {}) {
  return requestDiscord(
    `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
    token,
    { method: "DELETE" },
    options
  );
}

async function createMessageThread(channelId, messageId, token, payload, options = {}) {
  return requestDiscord(
    `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/threads`,
    token,
    {
      method: "POST",
      body: JSON.stringify(payload || {}),
    },
    options
  );
}

module.exports = {
  buildAllowedMentions,
  buildDiscordApiUrl,
  createMessageThread,
  doesMessageMatchPayload,
  getDiscordRetryDelayMs,
  buildLiveMessagePayload,
  buildSocialFeedMessagePayload,
  buildMentionContent,
  deleteChannelMessage,
  listChannelMessages,
  sendChannelMessage,
};
