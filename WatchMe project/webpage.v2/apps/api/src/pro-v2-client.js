import { apiConfig } from "./config.js";

function toCleanString(value) {
  const next = String(value || "").trim();
  return next || "";
}

function parseDiscordPermissions(value) {
  try {
    return BigInt(String(value || "0"));
  } catch {
    return 0n;
  }
}

function canManageGuild(guild = {}) {
  if (guild?.owner === true) return true;
  const permissions = parseDiscordPermissions(guild?.permissions);
  const administrator = 0x8n;
  const manageGuild = 0x20n;
  return (permissions & administrator) === administrator || (permissions & manageGuild) === manageGuild;
}

export function getManageableGuilds(guilds = []) {
  if (!Array.isArray(guilds)) return [];
  return guilds
    .filter((guild) => guild && canManageGuild(guild))
    .map((guild) => ({
      guild_id: toCleanString(guild.id),
      name: toCleanString(guild.name),
      icon_url: guild.icon
        ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
        : "",
    }))
    .filter((guild) => guild.guild_id);
}

async function requestProV2(path, {
  method = "GET",
  discordUserId = "",
  body,
} = {}) {
  const headers = {};
  if (apiConfig.proV2ApiToken) {
    headers.Authorization = `Bearer ${apiConfig.proV2ApiToken}`;
  }
  if (discordUserId) {
    headers["x-discord-user-id"] = discordUserId;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${apiConfig.proV2ApiBaseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && payload.error
        ? payload.error
        : `Pro V2 request failed: ${method} ${path} -> ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

export async function syncDiscordWorkspaceToProV2({ user, guilds }) {
  return await requestProV2("/api/internal/workspace/sync", {
    method: "POST",
    body: {
      discord_user_id: user?.id,
      user,
      manageable_guilds: getManageableGuilds(guilds),
    },
  });
}

export async function getProV2Me(discordUserId) {
  return await requestProV2("/api/internal/me", {
    discordUserId,
  });
}

export async function getProV2Guilds(discordUserId) {
  return await requestProV2("/api/internal/guilds", {
    discordUserId,
  });
}

export async function getProV2GuildChannels(discordUserId, guildId) {
  return await requestProV2(`/api/internal/guilds/${encodeURIComponent(guildId)}/channels`, {
    discordUserId,
  });
}

export async function getProV2KeywordFilters(discordUserId, guildId) {
  return await requestProV2(`/api/internal/guilds/${encodeURIComponent(guildId)}/keyword-filters`, {
    discordUserId,
  });
}

export async function addProV2KeywordFilter(discordUserId, guildId, body = {}) {
  return await requestProV2(`/api/internal/guilds/${encodeURIComponent(guildId)}/keyword-filters`, {
    method: "POST",
    discordUserId,
    body,
  });
}

export async function deleteProV2KeywordFilter(discordUserId, guildId, body = {}) {
  return await requestProV2(`/api/internal/guilds/${encodeURIComponent(guildId)}/keyword-filters`, {
    method: "DELETE",
    discordUserId,
    body,
  });
}

export async function getProV2Workspace(discordUserId, guildId) {
  return await requestProV2(`/api/internal/workspace/${encodeURIComponent(guildId)}`, {
    discordUserId,
  });
}

export async function getProV2Templates(discordUserId) {
  return await requestProV2("/api/internal/templates", {
    discordUserId,
  });
}

export async function getProV2SocialConnections(discordUserId) {
  return await requestProV2("/api/internal/social/connections", {
    discordUserId,
  });
}

export async function startProV2SocialOAuth(discordUserId, platform) {
  return await requestProV2("/api/internal/social/oauth/start", {
    method: "POST",
    discordUserId,
    body: { platform, return_to: "web" },
  });
}

export async function disconnectProV2Social(discordUserId, platform) {
  return await requestProV2(`/api/internal/social/connections/${encodeURIComponent(platform)}`, {
    method: "DELETE",
    discordUserId,
  });
}

export async function selectProV2SocialPage(discordUserId, platform, pageId) {
  return await requestProV2(`/api/internal/social/connections/${encodeURIComponent(platform)}/select-page`, {
    method: "POST",
    discordUserId,
    body: { page_id: pageId },
  });
}

export async function saveProV2Template(discordUserId, template) {
  return await requestProV2("/api/internal/templates", {
    method: "POST",
    discordUserId,
    body: template,
  });
}

export async function getProV2AutomationHome(discordUserId) {
  return await requestProV2("/api/internal/automation/home", {
    discordUserId,
  });
}

export async function getProV2AutomationActivity(discordUserId, limit = 50) {
  return await requestProV2(`/api/internal/automation/activity?limit=${encodeURIComponent(limit)}`, {
    discordUserId,
  });
}

export async function getProV2AutomationScheduled(discordUserId) {
  return await requestProV2("/api/internal/automation/scheduled", {
    discordUserId,
  });
}

export async function getProV2ScheduledPosts(discordUserId, guildId) {
  return await requestProV2(`/api/internal/scheduled-posts/${encodeURIComponent(guildId)}`, {
    discordUserId,
  });
}

export async function saveProV2ScheduledPost(discordUserId, guildId, scheduledPost) {
  return await requestProV2(`/api/internal/scheduled-posts/${encodeURIComponent(guildId)}`, {
    method: "POST",
    discordUserId,
    body: scheduledPost,
  });
}

export async function saveProV2GuildConfig(discordUserId, guildId, config) {
  return await requestProV2(`/api/guilds/${encodeURIComponent(guildId)}/config`, {
    method: "PUT",
    discordUserId,
    body: config,
  });
}
