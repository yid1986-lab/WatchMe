const http = require("http");
const crypto = require("crypto");
const { getApiConfig } = require("./config");
const {
  getMobileSessionToken,
  issueMobileSession,
  verifyMobileSessionToken,
} = require("./mobile-auth");
const {
  getPagerStatus,
  runPagerSweep,
} = require("./paging");
const {
  buildPlatformTopicKey,
  extractSocialOriginMarkers,
} = require("../../../packages/shared/src");
const {
  addGuildKeywordFilter,
  assertOrBindBillingProGuild,
  buildEntitlementRecord,
  consumeSocialOAuthState,
  createSocialOAuthState,
  createCreatorPostDispatch,
  deleteCreatorSocialConnection,
  disableMobilePushDevice,
  evaluateSocialOriginCandidate,
  getAutomationHome,
  getActiveCreatorSocialPlatforms,
  getCreatorDispatchForUser,
  getCreatorPostBuilderState,
  getCreatorSocialConnectionForOAuth,
  getCreatorSocialConnections,
  getCreatorProfiles,
  getGuildWorkspaceSnapshot,
  getGuildConfig,
  getCreatorPostTemplates,
  getLatestSubscriptionForUser,
  getMemberEntitlement,
  getMemberGuilds,
  getUser,
  getQueueStats,
  ingestPlatformEvent,
  listAutomationActivity,
  listGuildKeywordFilters,
  listScheduledCreatorDispatches,
  recordSocialOriginDecision,
  recordAutomationActivity,
  registerMobilePushDevice,
  removeGuildKeywordFilter,
  saveCreatorIdentity,
  saveCreatorProfile,
  saveCreatorPostTemplate,
  syncMemberWorkspaceState,
  syncCreatorPlatformSubscriptions,
  syncGuildPlatformSubscriptions,
  syncLitePlatformSubscriptions,
  upsertCreatorSocialConnection,
  updateCreatorAccess,
  upsertGuildConfig,
} = require("./queries");
const {
  enqueuePlatformEventIngest,
  enqueuePlatformSubscriptionRenewal,
  enqueueMobilePush,
  enqueueSocialPostDispatch,
} = require("./jobs");
const {
  addLiteCreator,
  buildLiteUpgradePrompt,
  getLiteCapacityStatus,
  getLiteCreators,
  normalizeLiteCreatorInput,
  removeLiteCreator,
  validateLiteCreatorInput,
} = require("./lite");
const {
  sendBadRequest,
  sendJson,
  sendMethodNotAllowed,
  sendNotFound,
} = require("./response");
const { normalizeInstagramMediaAdapterBody } = require("./social-adapters");
const { cleanText, readJsonBody, toBoolean, toInteger } = require("./utils");

const POST_BUILDER_PLATFORMS = ["facebook", "instagram", "x", "tiktok", "youtube", "twitch"];
const INTERNAL_BEARER_PREFIX = "bearer ";

function getInternalAuthToken(req) {
  const bearer = String(req.headers.authorization || "").trim();
  if (bearer.toLowerCase().startsWith(INTERNAL_BEARER_PREFIX)) {
    return bearer.slice(INTERNAL_BEARER_PREFIX.length).trim();
  }
  return String(req.headers["x-internal-token"] || "").trim();
}

function isInternalAuthorized(req) {
  const config = getApiConfig();
  if (!config.internalApiToken) {
    return config.nodeEnv !== "production";
  }
  return getInternalAuthToken(req) === config.internalApiToken;
}

function getInternalDiscordUserId(req) {
  return cleanText(req.headers["x-discord-user-id"]);
}

function getInternalWorkspaceOptions() {
  const config = getApiConfig();
  return {
    ownerProUsers: config.ownerProUsers,
    manualProUsers: config.manualProUsers,
    testerProUsers: config.testerProUsers,
  };
}

function getPublicWriteToken(req) {
  const bearer = String(req.headers.authorization || "").trim();
  if (bearer.toLowerCase().startsWith(INTERNAL_BEARER_PREFIX)) {
    return bearer.slice(INTERNAL_BEARER_PREFIX.length).trim();
  }
  return String(req.headers["x-api-token"] || "").trim();
}

function isLiteWriteAuthorized(req) {
  const config = getApiConfig();
  if (!config.liteWriteToken) {
    return config.nodeEnv !== "production";
  }
  return getPublicWriteToken(req) === config.liteWriteToken;
}

function isMobileWriteAuthorized(req) {
  const config = getApiConfig();
  if (!config.mobileWriteToken) {
    return config.nodeEnv !== "production";
  }
  return getPublicWriteToken(req) === config.mobileWriteToken;
}

function getExplicitMobileUserId(req) {
  return cleanText(req.headers["x-discord-user-id"] || req.headers["x-watchme-discord-user-id"]);
}

function getAuthorizedMobileUser(req, expectedDiscordUserId) {
  const config = getApiConfig();
  const requireSignedSession =
    config.mobileSessionRequired || (config.nodeEnv === "production");
  if (config.mobileSessionSecret) {
    const verification = verifyMobileSessionToken(
      getMobileSessionToken(req),
      config.mobileSessionSecret
    );
    if (verification.ok) {
      if (!expectedDiscordUserId || verification.discordUserId === expectedDiscordUserId) {
        return {
          ok: true,
          authMode: "signed_session",
          discordUserId: verification.discordUserId,
          expiresAtSeconds: verification.expiresAtSeconds,
        };
      }
      return {
        ok: false,
        code: "user_mismatch",
      };
    }

    if (requireSignedSession) {
      return {
        ok: false,
        code: verification.code || "unauthorized",
      };
    }
  }

  if (requireSignedSession) {
    return {
      ok: false,
      code: "unauthorized",
    };
  }

  if (isMobileWriteAuthorized(req)) {
    const explicitUserId = getExplicitMobileUserId(req);
    if (expectedDiscordUserId && explicitUserId && explicitUserId !== expectedDiscordUserId) {
      return {
        ok: false,
        code: "user_mismatch",
      };
    }

    return {
      ok: true,
      authMode: "app_token",
      discordUserId: explicitUserId || expectedDiscordUserId || null,
      expiresAtSeconds: null,
    };
  }

  return {
    ok: false,
    code: "unauthorized",
  };
}

function getAuthorizedMobileRequestUser(req) {
  const explicitUserId = getExplicitMobileUserId(req);
  const authorized = getAuthorizedMobileUser(req, explicitUserId || null);
  if (!authorized.ok) {
    return authorized;
  }

  const discordUserId = authorized.discordUserId || explicitUserId;
  if (!discordUserId) {
    return {
      ok: false,
      code: "missing_user",
    };
  }

  return {
    ...authorized,
    discordUserId,
  };
}

function isFirebasePushConfigured() {
  const config = getApiConfig();
  return Boolean(config.firebaseServiceAccountJson || config.firebaseServiceAccountPath || config.firebaseProjectId);
}

function buildDiscordApiUrl(path, baseUrl) {
  const cleanBase = String(baseUrl || "https://discord.com/api/v10").replace(/\/+$/, "");
  const cleanPath = String(path || "").startsWith("/") ? String(path || "") : `/${path || ""}`;
  return `${cleanBase}${cleanPath}`;
}

function parseDiscordPermissions(value) {
  try {
    return BigInt(String(value || "0"));
  } catch (error) {
    return 0n;
  }
}

function canManageDiscordGuild(guild = {}) {
  if (guild?.owner === true) {
    return true;
  }
  const permissions = parseDiscordPermissions(guild?.permissions);
  const administrator = 0x8n;
  const manageGuild = 0x20n;
  return (permissions & administrator) === administrator || (permissions & manageGuild) === manageGuild;
}

function getDiscordAvatarUrl(user = {}) {
  const userId = cleanText(user.id);
  const avatar = cleanText(user.avatar);
  if (!userId || !avatar) {
    return null;
  }
  const extension = avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.${extension}`;
}

function getManageableDiscordGuilds(guilds = []) {
  if (!Array.isArray(guilds)) {
    return [];
  }
  return guilds
    .filter((guild) => guild && canManageDiscordGuild(guild))
    .map((guild) => {
      const guildId = cleanText(guild.id);
      const icon = cleanText(guild.icon);
      return {
        guild_id: guildId,
        name: cleanText(guild.name) || null,
        icon_url: guildId && icon ? `https://cdn.discordapp.com/icons/${guildId}/${icon}.png` : null,
      };
    })
    .filter((guild) => guild.guild_id);
}

async function fetchDiscordOAuthJson(path, accessToken) {
  const config = getApiConfig();
  const response = await fetch(buildDiscordApiUrl(path, config.discordApiBaseUrl), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (error) {
    payload = text;
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && payload.message
      ? payload.message
      : `Discord request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

async function fetchDiscordBotJson(path) {
  const config = getApiConfig();
  const token = String(config.discordBotToken || "").trim();
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN is not configured.");
  }
  const response = await fetch(buildDiscordApiUrl(path, config.discordApiBaseUrl), {
    headers: {
      Authorization: `Bot ${token}`,
    },
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
      payload && typeof payload === "object" && payload.message
        ? payload.message
        : `Discord request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

function normalizeDiscordGuildChannels(payload) {
  if (!Array.isArray(payload)) {
    return [];
  }
  const selectableTypes = new Set([0, 5]);
  return payload
    .filter((ch) => ch && selectableTypes.has(Number(ch.type)))
    .map((ch) => ({
      id: cleanText(ch.id),
      name: cleanText(ch.name) || "channel",
      type: Number(ch.type),
      parent_id: ch.parent_id ? cleanText(ch.parent_id) : null,
      position: Number.isFinite(Number(ch.position)) ? Number(ch.position) : 0,
    }))
    .filter((channel) => channel.id)
    .sort((a, b) => a.position - b.position);
}

function normalizeDiscordGuildRoles(payload) {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((role) => ({
      id: cleanText(role?.id),
      name: cleanText(role?.name) || "role",
      color: Number.isFinite(Number(role?.color)) ? Number(role.color) : 0,
      position: Number.isFinite(Number(role?.position)) ? Number(role.position) : 0,
      mentionable: Boolean(role?.mentionable),
      hoist: Boolean(role?.hoist),
      managed: Boolean(role?.managed),
    }))
    .filter((role) => role.id)
    .sort((a, b) => b.position - a.position);
}

async function loadGuildDiscordChannels(guildId) {
  const safeId = encodeURIComponent(guildId);
  const raw = await fetchDiscordBotJson(`/guilds/${safeId}/channels`);
  return normalizeDiscordGuildChannels(raw);
}

async function loadGuildDiscordRoles(guildId) {
  const safeId = encodeURIComponent(String(guildId || "").trim());
  if (!safeId) {
    return [];
  }
  const raw = await fetchDiscordBotJson(`/guilds/${safeId}/roles`);
  return normalizeDiscordGuildRoles(raw);
}

async function loadGuildDiscordMembers(guildId) {
  const safeId = encodeURIComponent(String(guildId || "").trim());
  if (!safeId) {
    return [];
  }

  const collected = new Map();
  let after = null;

  for (;;) {
    const query = new URLSearchParams({ limit: "1000" });
    if (after) {
      query.set("after", after);
    }
    const path = `/guilds/${safeId}/members?${query.toString()}`;
    const raw = await fetchDiscordBotJson(path);
    if (!Array.isArray(raw) || raw.length === 0) {
      break;
    }
    for (const row of raw) {
      const user = row?.user;
      if (!user || user.bot) {
        continue;
      }
      const id = cleanText(user.id);
      if (!id) continue;
      const displayName =
        cleanText(row.nick) ||
        cleanText(user.global_name || user.globalName) ||
        cleanText(user.username) ||
        id;
      const avatarUrl = getDiscordAvatarUrl(user) || "";
      collected.set(id, {
        discord_user_id: id,
        display_name: displayName,
        nickname: cleanText(row.nick) || "",
        avatar_url: avatarUrl,
      });
    }
    if (raw.length < 1000) break;
    const last = raw[raw.length - 1];
    const lastId = cleanText(last?.user?.id);
    if (!lastId || lastId === after) break;
    after = lastId;
    if (collected.size > 10000) break;
  }

  return Array.from(collected.values()).sort((a, b) =>
    String(a.display_name || "").localeCompare(String(b.display_name || ""), undefined, { sensitivity: "base" }),
  );
}

async function handleInternalGuildMembers(req, res, guildId) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const discordUserId = getInternalDiscordUserId(req);
  if (!discordUserId) {
    return sendBadRequest(res, "Missing x-discord-user-id");
  }

  const canManage = await assertUserCanManageGuild(discordUserId, guildId);
  if (!canManage) {
    return sendJson(res, 403, { error: "Guild access denied" });
  }

  try {
    const members = await loadGuildDiscordMembers(guildId);
    return sendJson(res, 200, {
      ok: true,
      guild_id: guildId,
      members,
    });
  } catch (error) {
    return sendJson(res, 503, {
      error: error?.message || "Unable to load Discord members",
    });
  }
}

async function handleMobileGuildMembers(req, res, guildId) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  const authorized = await getAuthorizedMobileGuild(req, guildId);
  if (!authorized.ok) {
    return sendJson(res, authorized.code === "guild_forbidden" ? 403 : 401, {
      error: authorized.code === "guild_forbidden" ? "Guild access denied" : "Unauthorized",
    });
  }

  try {
    const members = await loadGuildDiscordMembers(guildId);
    return sendJson(res, 200, {
      ok: true,
      guild_id: guildId,
      members,
    });
  } catch (error) {
    return sendJson(res, 503, {
      error: error?.message || "Unable to load Discord members",
    });
  }
}

async function handleMobileGuildRoles(req, res, guildId) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  const authorized = await getAuthorizedMobileGuild(req, guildId);
  if (!authorized.ok) {
    return sendJson(res, authorized.code === "guild_forbidden" ? 403 : 401, {
      error: authorized.code === "guild_forbidden" ? "Guild access denied" : "Unauthorized",
    });
  }

  try {
    const roles = await loadGuildDiscordRoles(guildId);
    return sendJson(res, 200, {
      ok: true,
      guild_id: guildId,
      roles,
    });
  } catch (error) {
    return sendJson(res, 503, {
      error: error?.message || "Unable to load Discord roles",
    });
  }
}

async function assertUserCanManageGuild(discordUserId, guildId) {
  const manageable = await getMemberGuilds(discordUserId, {
    skipBillingGuildFilter: true,
    entitlementOptions: getInternalWorkspaceOptions(),
  });
  return manageable.some((row) => String(row.guild_id) === String(guildId));
}

async function handleInternalGuildRoles(req, res, guildId) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const discordUserId = getInternalDiscordUserId(req);
  if (!discordUserId) {
    return sendBadRequest(res, "Missing x-discord-user-id");
  }

  const canManage = await assertUserCanManageGuild(discordUserId, guildId);
  if (!canManage) {
    return sendJson(res, 403, { error: "Guild access denied" });
  }

  try {
    const roles = await loadGuildDiscordRoles(guildId);
    return sendJson(res, 200, {
      ok: true,
      guild_id: guildId,
      roles,
    });
  } catch (error) {
    return sendJson(res, 503, {
      error: error?.message || "Unable to load Discord roles",
    });
  }
}

async function handleMobileGuildChannels(req, res, guildId) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  const authorized = await getAuthorizedMobileGuild(req, guildId);
  if (!authorized.ok) {
    return sendJson(res, authorized.code === "guild_forbidden" ? 403 : 401, {
      error: authorized.code === "guild_forbidden" ? "Guild access denied" : "Unauthorized",
    });
  }

  try {
    const channels = await loadGuildDiscordChannels(guildId);
    return sendJson(res, 200, {
      ok: true,
      guild_id: guildId,
      channels,
    });
  } catch (error) {
    return sendJson(res, 503, {
      error: error?.message || "Unable to load Discord channels",
    });
  }
}

async function handleInternalGuildChannels(req, res, guildId) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const discordUserId = getInternalDiscordUserId(req);
  if (!discordUserId) {
    return sendBadRequest(res, "Missing x-discord-user-id");
  }

  const canManage = await assertUserCanManageGuild(discordUserId, guildId);
  if (!canManage) {
    return sendJson(res, 403, { error: "Guild access denied" });
  }

  try {
    const channels = await loadGuildDiscordChannels(guildId);
    return sendJson(res, 200, {
      ok: true,
      guild_id: guildId,
      channels,
    });
  } catch (error) {
    return sendJson(res, 503, {
      error: error?.message || "Unable to load Discord channels",
    });
  }
}

async function handleMobileGuildKeywordFilters(req, res, guildId) {
  const authorized = await getAuthorizedMobileGuild(req, guildId);
  if (!authorized.ok) {
    return sendJson(res, authorized.code === "guild_forbidden" ? 403 : 401, {
      error: authorized.code === "guild_forbidden" ? "Guild access denied" : "Unauthorized",
    });
  }

  try {
    if (req.method === "GET") {
      const keyword_filters = await listGuildKeywordFilters(guildId);
      return sendJson(res, 200, {
        ok: true,
        guild_id: guildId,
        keyword_filters,
      });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      await addGuildKeywordFilter(guildId, body.platform || "all", body.keyword || "");
      const keyword_filters = await listGuildKeywordFilters(guildId);
      return sendJson(res, 200, {
        ok: true,
        guild_id: guildId,
        keyword_filters,
      });
    }

    if (req.method === "DELETE") {
      const body = await readJsonBody(req);
      await removeGuildKeywordFilter(guildId, body.platform || "all", body.keyword || "");
      const keyword_filters = await listGuildKeywordFilters(guildId);
      return sendJson(res, 200, {
        ok: true,
        guild_id: guildId,
        keyword_filters,
      });
    }

    return sendMethodNotAllowed(res);
  } catch (error) {
    return sendBadRequest(res, error.message || "Invalid keyword filter payload");
  }
}

async function handleInternalGuildKeywordFilters(req, res, guildId) {
  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const discordUserId = getInternalDiscordUserId(req);
  if (!discordUserId) {
    return sendBadRequest(res, "Missing x-discord-user-id");
  }

  const canManage = await assertUserCanManageGuild(discordUserId, guildId);
  if (!canManage) {
    return sendJson(res, 403, { error: "Guild access denied" });
  }

  try {
    if (req.method === "GET") {
      const keyword_filters = await listGuildKeywordFilters(guildId);
      return sendJson(res, 200, {
        ok: true,
        guild_id: guildId,
        keyword_filters,
      });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      await addGuildKeywordFilter(guildId, body.platform || "all", body.keyword || "");
      const keyword_filters = await listGuildKeywordFilters(guildId);
      return sendJson(res, 200, {
        ok: true,
        guild_id: guildId,
        keyword_filters,
      });
    }

    if (req.method === "DELETE") {
      const body = await readJsonBody(req);
      await removeGuildKeywordFilter(guildId, body.platform || "all", body.keyword || "");
      const keyword_filters = await listGuildKeywordFilters(guildId);
      return sendJson(res, 200, {
        ok: true,
        guild_id: guildId,
        keyword_filters,
      });
    }

    return sendMethodNotAllowed(res);
  } catch (error) {
    return sendBadRequest(res, error.message || "Invalid keyword filter payload");
  }
}

async function recordAutomationActivityAndPush(discordUserId, event = {}) {
  const activity = await recordAutomationActivity(discordUserId, event);
  if (activity?.activity_id) {
    await enqueueMobilePush(activity.activity_id, discordUserId, {
      eventType: activity.event_type,
    }).catch(() => null);
  }
  return activity;
}

function isPublicWriteAuthorized(req) {
  const config = getApiConfig();
  if (!config.publicWriteToken) {
    return config.nodeEnv !== "production";
  }
  return getPublicWriteToken(req) === config.publicWriteToken;
}

function getPlatformEventPatch(body = {}) {
  const platform = cleanText(body.platform)?.toLowerCase();
  const eventType = cleanText(body.event_type)?.toLowerCase();
  const sourceKey = cleanText(body.source_key);

  if (!platform || !eventType || !sourceKey) {
    throw new Error("platform, event_type, and source_key are required");
  }

  return {
    platform,
    event_type: eventType,
    source_key: sourceKey,
    source_external_id: cleanText(body.source_external_id),
    source_created_at: cleanText(body.source_created_at),
    provider_event_id: cleanText(body.provider_event_id),
    dedupe_key: cleanText(body.dedupe_key),
    payload_json: typeof body.payload_json === "object" && body.payload_json !== null
      ? body.payload_json
      : {},
  };
}

function getGuildConfigPatch(body = {}, current = {}) {
  const next = {
    announce_channel_id: cleanText(body.announce_channel_id ?? current.announce_channel_id),
    live_channel_id: cleanText(body.live_channel_id ?? current.live_channel_id),
    socials_feed_channel_id: cleanText(body.socials_feed_channel_id ?? current.socials_feed_channel_id),
    live_role_id: cleanText(body.live_role_id ?? current.live_role_id),
    auto_cleanup: toBoolean(body.auto_cleanup, Boolean(current.auto_cleanup)),
    cooldown_seconds: toInteger(body.cooldown_seconds, Number(current.cooldown_seconds || 600)),
    mention_mode: normalizeMentionMode(body.mention_mode ?? current.mention_mode, "role"),
    brand_name: cleanText(body.brand_name ?? current.brand_name),
    brand_logo_url: cleanText(body.brand_logo_url ?? current.brand_logo_url),
    preview_image_url: cleanText(body.preview_image_url ?? current.preview_image_url),
    footer_text: cleanText(body.footer_text ?? current.footer_text),
    guild_twitch_url: cleanText(body.guild_twitch_url ?? current.guild_twitch_url),
    guild_youtube_url: cleanText(body.guild_youtube_url ?? current.guild_youtube_url),
    guild_kick_url: cleanText(body.guild_kick_url ?? current.guild_kick_url),
    live_filter_games_json: body.live_filter_games_json !== undefined
      ? normalizeStringArray(body.live_filter_games_json)
      : normalizeStringArray(current.live_filter_games_json),
    live_filter_languages_json: body.live_filter_languages_json !== undefined
      ? normalizeStringArray(body.live_filter_languages_json)
      : normalizeStringArray(current.live_filter_languages_json),
    live_filter_min_viewers:
      body.live_filter_min_viewers !== undefined
        ? toInteger(body.live_filter_min_viewers, null)
        : toInteger(current.live_filter_min_viewers, null),
    live_filter_max_viewers:
      body.live_filter_max_viewers !== undefined
        ? toInteger(body.live_filter_max_viewers, null)
        : toInteger(current.live_filter_max_viewers, null),
    category_role_routes_json: body.category_role_routes_json !== undefined
      ? normalizeCategoryRoleRoutes(body.category_role_routes_json)
      : normalizeCategoryRoleRoutes(current.category_role_routes_json),
    auto_start_thread: toBoolean(
      body.auto_start_thread,
      Boolean(current.auto_start_thread)
    ),
    auto_start_thread_name: cleanText(body.auto_start_thread_name ?? current.auto_start_thread_name),
    stream_end_message_enabled: toBoolean(
      body.stream_end_message_enabled,
      Boolean(current.stream_end_message_enabled)
    ),
    stream_end_message_template: cleanText(
      body.stream_end_message_template ?? current.stream_end_message_template
    ),
  };

  if (next.announce_channel_id && !next.live_channel_id) {
    next.live_channel_id = next.announce_channel_id;
  }

  if (Number.isFinite(next.live_filter_min_viewers) && next.live_filter_min_viewers < 0) {
    next.live_filter_min_viewers = 0;
  }

  if (Number.isFinite(next.live_filter_max_viewers) && next.live_filter_max_viewers < 0) {
    next.live_filter_max_viewers = 0;
  }

  if (
    Number.isFinite(next.live_filter_min_viewers) &&
    Number.isFinite(next.live_filter_max_viewers) &&
    next.live_filter_max_viewers > 0 &&
    next.live_filter_min_viewers > next.live_filter_max_viewers
  ) {
    next.live_filter_max_viewers = next.live_filter_min_viewers;
  }

  return next;
}

function getCreatorProfilePatch(body = {}) {
  return {
    display_name: cleanText(body.display_name),
    twitch_url: cleanText(body.twitch_url),
    twitch_external_id: cleanText(body.twitch_external_id),
    youtube_url: cleanText(body.youtube_url),
    youtube_external_id: cleanText(body.youtube_external_id),
    kick_url: cleanText(body.kick_url),
    kick_external_id: cleanText(body.kick_external_id),
    kick_slug: cleanText(body.kick_slug),
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function getMediaKindFromUrl(url) {
  const path = String(url || "").toLowerCase().split("?")[0];
  if (/\.(mp4|mov|webm|m4v|mkv|avi)$/.test(path)) {
    return "video";
  }
  if (/\.(jpg|jpeg|png|gif|webp|bmp|tif|tiff|heic|heif)$/.test(path)) {
    return "image";
  }
  return "unknown";
}

function normalizeMediaUrls(value, { max = 8 } = {}) {
  const urls = normalizeStringArray(value)
    .filter((item) => isHttpUrl(item))
    .slice(0, Math.max(1, Number(max || 8)));
  return Array.from(new Set(urls));
}

function summarizeMediaUrls(mediaUrls = []) {
  let imageCount = 0;
  let videoCount = 0;
  let unknownCount = 0;
  for (const url of mediaUrls) {
    const kind = getMediaKindFromUrl(url);
    if (kind === "image") imageCount += 1;
    else if (kind === "video") videoCount += 1;
    else unknownCount += 1;
  }
  return {
    total: mediaUrls.length,
    image_count: imageCount,
    video_count: videoCount,
    unknown_count: unknownCount,
  };
}

function normalizeScheduledAt(value) {
  const raw = cleanText(value);
  if (!raw) {
    return null;
  }

  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("scheduled_at must be a valid date");
  }

  return date.toISOString();
}

function normalizeMentionMode(value, fallback = "role") {
  const normalized = cleanText(value)?.toLowerCase() || null;
  return ["role", "both", "member", "none"].includes(normalized || "")
    ? normalized
    : fallback;
}

function normalizeCategoryRoleRoutes(value) {
  const input = Array.isArray(value) ? value : [];
  return input
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const category = cleanText(item.category ?? item.match ?? item.game_name);
      const roleId = cleanText(item.role_id ?? item.roleId);
      const mentionMode = normalizeMentionMode(item.mention_mode ?? item.mentionMode, null);
      if (!category || !roleId) {
        return null;
      }

      return {
        category,
        role_id: roleId,
        mention_mode: mentionMode,
      };
    })
    .filter(Boolean);
}

function collectNestedStringValues(value, bucket = [], limit = 50) {
  if (bucket.length >= limit || value === null || value === undefined) {
    return bucket;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectNestedStringValues(item, bucket, limit);
      if (bucket.length >= limit) {
        break;
      }
    }
    return bucket;
  }

  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      collectNestedStringValues(item, bucket, limit);
      if (bucket.length >= limit) {
        break;
      }
    }
    return bucket;
  }

  const text = cleanText(String(value));
  if (text) {
    bucket.push(text);
  }

  return bucket;
}

function getSocialCandidatePatch(body = {}) {
  const platform = cleanText(body.platform)?.toLowerCase();
  if (!platform) {
    throw new Error("platform is required");
  }

  const metadataJson = typeof body.metadata_json === "object" && body.metadata_json !== null
    ? body.metadata_json
    : {};
  const normalizedUrls = normalizeStringArray(body.normalized_urls);
  const markerStrings = normalizeStringArray(body.marker_strings);
  const relatedPostIds = normalizeStringArray(body.related_post_ids);
  const explicitOriginKeys = normalizeStringArray(body.origin_keys).map((value) => value.toLowerCase());
  const explicitOriginFingerprints = normalizeStringArray(body.origin_fingerprints).map((value) => value.toLowerCase());
  const externalAppIds = normalizeStringArray(body.external_app_ids);
  const extractedMarkers = extractSocialOriginMarkers([
    cleanText(body.normalized_text),
    ...normalizedUrls,
    ...markerStrings,
    ...collectNestedStringValues(metadataJson),
  ]);

  return {
    platform,
    external_post_id: cleanText(body.external_post_id),
    external_account_id: cleanText(body.external_account_id),
    external_account_name: cleanText(body.external_account_name),
    external_app_id: cleanText(body.external_app_id),
    external_parent_post_id: cleanText(body.external_parent_post_id),
    repost_of_external_post_id: cleanText(body.repost_of_external_post_id),
    quote_of_external_post_id: cleanText(body.quote_of_external_post_id),
    shared_external_post_id: cleanText(body.shared_external_post_id),
    normalized_text: cleanText(body.normalized_text),
    normalized_urls: normalizedUrls,
    media_urls_json: normalizeStringArray(body.media_urls_json),
    marker_strings: markerStrings,
    related_post_ids: relatedPostIds,
    external_app_ids: Array.from(new Set(
      [cleanText(body.external_app_id), ...externalAppIds].filter(Boolean)
    )),
    origin_keys: Array.from(new Set([
      ...explicitOriginKeys,
      ...extractedMarkers.originKeys,
    ])),
    origin_fingerprints: Array.from(new Set([
      ...explicitOriginFingerprints,
      ...extractedMarkers.originFingerprints,
    ])),
    metadata_json: metadataJson,
  };
}

function getSocialEventIngestPatch(body = {}) {
  const candidate = getSocialCandidatePatch(body);
  const sourceKey =
    cleanText(body.source_key) ||
    buildPlatformTopicKey({
      platform: candidate.platform,
      externalId: candidate.external_account_id,
      url: cleanText(body.source_url) || cleanText(body.external_account_url),
    });
  const externalPostId = cleanText(body.external_post_id);
  const sourceCreatedAt =
    cleanText(body.source_created_at) ||
    cleanText(body.published_at) ||
    null;

  if (!externalPostId) {
    throw new Error("external_post_id is required");
  }

  if (!sourceKey) {
    throw new Error("source_key, external_account_id, or source_url is required");
  }

  return {
    candidate,
    eventPatch: {
      platform: candidate.platform,
      event_type: cleanText(body.event_type)?.toLowerCase() || "social.post.created",
      source_key: sourceKey,
      source_external_id: externalPostId,
      source_created_at: sourceCreatedAt,
      provider_event_id: cleanText(body.provider_event_id) || externalPostId,
      dedupe_key: cleanText(body.dedupe_key),
      processing_state: cleanText(body.processing_state)?.toLowerCase() || "received",
      payload_json: {
        candidate,
        ingested_via: cleanText(body.ingested_via) || "internal_social_events",
        source_url: cleanText(body.source_url) || cleanText(body.external_account_url) || null,
        external_account_id: candidate.external_account_id,
        external_account_name: candidate.external_account_name,
        external_account_url: cleanText(body.external_account_url),
        external_account_handle: cleanText(body.external_account_handle),
        external_post_id: externalPostId,
        external_parent_post_id: candidate.external_parent_post_id,
        external_app_id: candidate.external_app_id,
        external_post_url:
          cleanText(body.external_post_url) ||
          (candidate.normalized_urls[0] || null),
        related_post_ids: candidate.related_post_ids,
        normalized_text: candidate.normalized_text,
        normalized_urls: candidate.normalized_urls,
        media_urls_json: candidate.media_urls_json,
        media_type: cleanText(body.media_type),
        media_product_type: cleanText(body.media_product_type),
        content_type: cleanText(body.content_type),
        content_label: cleanText(body.content_label),
        metadata_json: candidate.metadata_json,
      },
    },
  };
}

function getCreatorSocialConnectionPatch(platform, body = {}) {
  if (!POST_BUILDER_PLATFORMS.includes(platform)) {
    throw new Error("Unsupported social platform");
  }

  return {
    external_account_id: cleanText(body.external_account_id),
    external_account_name: cleanText(body.external_account_name),
    access_token: cleanText(body.access_token),
    refresh_token: cleanText(body.refresh_token),
    token_expires_at: cleanText(body.token_expires_at),
    status: cleanText(body.status) || "active",
    metadata_json: typeof body.metadata_json === "object" && body.metadata_json !== null
      ? body.metadata_json
      : {},
  };
}

function randomBase64Url(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString("base64url");
}

function sha256Base64Url(value) {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

function isoFromExpiresIn(expiresIn) {
  const seconds = Number(expiresIn || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function cleanMetadataObject(value) {
  return typeof value === "object" && value !== null ? value : {};
}

function publicPageOptions(pages = [], includeInstagram = false) {
  return pages.map((page) => {
    const option = {
      id: cleanText(page.id),
      name: cleanText(page.name) || cleanText(page.id),
      category: cleanText(page.category),
    };
    if (includeInstagram && page.instagram_business_account) {
      option.instagram_account_id = cleanText(page.instagram_business_account.id);
      option.instagram_account_name =
        cleanText(page.instagram_business_account.username) ||
        cleanText(page.instagram_business_account.name) ||
        cleanText(page.instagram_business_account.id);
    }
    return option;
  }).filter((page) => page.id);
}

async function fetchJsonOrThrow(fetchUrl, options = {}, errorPrefix = "Provider request failed") {
  const response = await fetch(fetchUrl, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const message =
      payload?.error_description ||
      payload?.error?.message ||
      payload?.error ||
      `${errorPrefix}: ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function getSocialOAuthRedirectUri(platform) {
  const config = getApiConfig();
  const normalizedPlatform = cleanText(platform).toLowerCase();
  if (normalizedPlatform === "facebook") {
    return config.facebookRedirectUri || config.socialOAuthRedirectUri;
  }
  if (normalizedPlatform === "instagram") {
    return config.instagramRedirectUri || config.facebookRedirectUri || config.socialOAuthRedirectUri;
  }
  if (normalizedPlatform === "tiktok") {
    return config.tiktokRedirectUri || config.socialOAuthRedirectUri;
  }
  if (normalizedPlatform === "x") {
    return config.xRedirectUri || config.socialOAuthRedirectUri;
  }
  if (normalizedPlatform === "youtube") {
    return config.youtubeRedirectUri || config.socialOAuthRedirectUri;
  }
  if (normalizedPlatform === "twitch") {
    return config.twitchRedirectUri || config.socialOAuthRedirectUri;
  }
  return config.socialOAuthRedirectUri;
}

function buildSocialOAuthAuthorizeUrl(platform, state, pkceChallenge = "") {
  const config = getApiConfig();
  const normalizedPlatform = cleanText(platform).toLowerCase();
  if (!POST_BUILDER_PLATFORMS.includes(normalizedPlatform)) {
    throw new Error("Unsupported social platform");
  }

  const redirectUri = getSocialOAuthRedirectUri(normalizedPlatform);

  if (normalizedPlatform === "facebook" || normalizedPlatform === "instagram") {
    const clientId = normalizedPlatform === "instagram"
      ? (config.instagramClientId || config.facebookAppId)
      : config.facebookAppId;
    const clientSecret = normalizedPlatform === "instagram"
      ? (config.instagramClientSecret || config.facebookAppSecret)
      : config.facebookAppSecret;
    if (!clientId || !clientSecret) {
      throw new Error(`${platformDisplayNameForError(normalizedPlatform)} OAuth is not configured`);
    }
    const url = new URL(`https://www.facebook.com/${config.facebookGraphVersion || "v22.0"}/dialog/oauth`);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set(
      "scope",
      "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish"
    );
    return url.toString();
  }

  if (normalizedPlatform === "youtube") {
    if (!config.youtubeClientId || !config.youtubeClientSecret) {
      throw new Error("YouTube OAuth is not configured");
    }
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", config.youtubeClientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly");
    return url.toString();
  }

  if (normalizedPlatform === "tiktok") {
    if (!config.tiktokClientKey || !config.tiktokClientSecret) {
      throw new Error("TikTok OAuth is not configured");
    }
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.searchParams.set("client_key", config.tiktokClientKey);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "user.info.basic,video.upload,video.publish");
    return url.toString();
  }

  if (normalizedPlatform === "x") {
    if (!config.xClientId || !config.xClientSecret) {
      throw new Error("X OAuth is not configured");
    }
    const url = new URL("https://twitter.com/i/oauth2/authorize");
    url.searchParams.set("client_id", config.xClientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "tweet.read tweet.write users.read offline.access");
    url.searchParams.set("code_challenge", pkceChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  if (normalizedPlatform === "twitch") {
    if (!config.twitchClientId || !config.twitchClientSecret) {
      throw new Error("Twitch OAuth is not configured");
    }
    const url = new URL("https://id.twitch.tv/oauth2/authorize");
    url.searchParams.set("client_id", config.twitchClientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "user:read:email");
    return url.toString();
  }

  throw new Error("Unsupported social platform");
}

function platformDisplayNameForError(platform) {
  return platform === "x" ? "X" : platform.charAt(0).toUpperCase() + platform.slice(1);
}

async function createSocialOAuthStartPayload(discordUserId, platform, returnTarget = "mobile", userAgent = "") {
  const state = randomBase64Url(32);
  const pkceVerifier = platform === "x" ? randomBase64Url(64) : null;
  const pkceChallenge = pkceVerifier ? sha256Base64Url(pkceVerifier) : "";
  const authorizeUrl = buildSocialOAuthAuthorizeUrl(platform, state, pkceChallenge);
  const savedState = await createSocialOAuthState({
    state,
    discordUserId,
    platform,
    returnTarget,
    pkceVerifier,
    metadata: { user_agent: cleanText(userAgent) },
  });
  return {
    ok: true,
    platform,
    authorize_url: authorizeUrl,
    expires_at: savedState?.expires_at || null,
  };
}

async function handleSocialOAuthStart(req, res) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  const authorized = getAuthorizedMobileRequestUser(req);
  if (!authorized.ok) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendBadRequest(res, error.message || "Invalid social OAuth payload");
  }

  const platform = cleanText(body.platform).toLowerCase();
  const returnTarget = cleanText(body.return_to).toLowerCase() === "web" ? "web" : "mobile";
  try {
    return sendJson(res, 200, await createSocialOAuthStartPayload(
      authorized.discordUserId,
      platform,
      returnTarget,
      req.headers["user-agent"]
    ));
  } catch (error) {
    return sendBadRequest(res, error.message || "Unable to start social OAuth");
  }
}

async function exchangeMetaCode(platform, code) {
  const config = getApiConfig();
  const clientId = platform === "instagram"
    ? (config.instagramClientId || config.facebookAppId)
    : config.facebookAppId;
  const clientSecret = platform === "instagram"
    ? (config.instagramClientSecret || config.facebookAppSecret)
    : config.facebookAppSecret;
  const url = new URL(`https://graph.facebook.com/${config.facebookGraphVersion || "v22.0"}/oauth/access_token`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("redirect_uri", getSocialOAuthRedirectUri(platform));
  url.searchParams.set("code", code);
  return await fetchJsonOrThrow(url, {}, "Meta token exchange failed");
}

async function fetchMetaPages(accessToken) {
  const config = getApiConfig();
  const url = new URL(`https://graph.facebook.com/${config.facebookGraphVersion || "v22.0"}/me/accounts`);
  url.searchParams.set("fields", "id,name,category,access_token,instagram_business_account{id,username,name}");
  url.searchParams.set("access_token", accessToken);
  const payload = await fetchJsonOrThrow(url, {}, "Meta pages request failed");
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function fetchMetaPageDetails(pageId, userAccessToken) {
  const config = getApiConfig();
  const url = new URL(`https://graph.facebook.com/${config.facebookGraphVersion || "v22.0"}/${encodeURIComponent(pageId)}`);
  url.searchParams.set("fields", "id,name,category,access_token,instagram_business_account{id,username,name}");
  url.searchParams.set("access_token", userAccessToken);
  return await fetchJsonOrThrow(url, {}, "Meta page request failed");
}

async function saveMetaConnectionFromPage(discordUserId, platform, page, tokenPayload = {}) {
  if (platform === "facebook") {
    return await upsertCreatorSocialConnection(discordUserId, "facebook", {
      external_account_id: cleanText(page.id),
      external_account_name: cleanText(page.name) || cleanText(page.id),
      access_token: cleanText(page.access_token),
      refresh_token: "",
      token_expires_at: isoFromExpiresIn(tokenPayload.expires_in),
      status: "active",
      metadata_json: {
        provider: "facebook",
        page_category: cleanText(page.category),
        scopes: cleanText(tokenPayload.scope),
      },
    });
  }

  const ig = page.instagram_business_account || null;
  if (!ig?.id) {
    throw new Error("Selected Facebook Page has no linked Instagram business account.");
  }
  return await upsertCreatorSocialConnection(discordUserId, "instagram", {
    external_account_id: cleanText(ig.id),
    external_account_name: cleanText(ig.username) || cleanText(ig.name) || cleanText(ig.id),
    access_token: cleanText(page.access_token),
    refresh_token: "",
    token_expires_at: isoFromExpiresIn(tokenPayload.expires_in),
    status: "active",
    metadata_json: {
      provider: "instagram",
      facebook_page_id: cleanText(page.id),
      facebook_page_name: cleanText(page.name),
      scopes: cleanText(tokenPayload.scope),
    },
  });
}

async function handleMetaOAuthCallback(platform, stateRow, code) {
  const tokenPayload = await exchangeMetaCode(platform, code);
  const userAccessToken = cleanText(tokenPayload.access_token);
  if (!userAccessToken) {
    throw new Error("Meta did not return an access token.");
  }

  const allPages = await fetchMetaPages(userAccessToken);
  const pages = platform === "instagram"
    ? allPages.filter((page) => page.instagram_business_account?.id)
    : allPages;

  if (!pages.length) {
    throw new Error(platform === "instagram"
      ? "No Facebook Page with a linked Instagram business account was returned."
      : "No Facebook Pages were returned for this account.");
  }

  if (pages.length === 1) {
    return await saveMetaConnectionFromPage(stateRow.discord_user_id, platform, pages[0], tokenPayload);
  }

  return await upsertCreatorSocialConnection(stateRow.discord_user_id, platform, {
    external_account_id: "",
    external_account_name: "",
    access_token: userAccessToken,
    refresh_token: "",
    token_expires_at: isoFromExpiresIn(tokenPayload.expires_in),
    status: "pending_selection",
    metadata_json: {
      provider: platform,
      pending_reason: "choose_page",
      page_options: publicPageOptions(pages, platform === "instagram"),
      scopes: cleanText(tokenPayload.scope),
    },
  });
}

async function exchangeTikTokCode(code) {
  const config = getApiConfig();
  const body = new URLSearchParams({
    client_key: config.tiktokClientKey,
    client_secret: config.tiktokClientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: getSocialOAuthRedirectUri("tiktok"),
  });
  return await fetchJsonOrThrow("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  }, "TikTok token exchange failed");
}

async function handleTikTokOAuthCallback(stateRow, code) {
  const tokenPayload = await exchangeTikTokCode(code);
  const accessToken = cleanText(tokenPayload.access_token);
  const openId = cleanText(tokenPayload.open_id);
  const userInfo = accessToken
    ? await fetchJsonOrThrow("https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name", {
        headers: { Authorization: `Bearer ${accessToken}` },
      }, "TikTok user request failed").catch(() => null)
    : null;
  const user = userInfo?.data?.user || {};
  return await upsertCreatorSocialConnection(stateRow.discord_user_id, "tiktok", {
    external_account_id: cleanText(user.open_id) || openId,
    external_account_name: cleanText(user.display_name) || cleanText(user.open_id) || openId,
    access_token: accessToken,
    refresh_token: cleanText(tokenPayload.refresh_token),
    token_expires_at: isoFromExpiresIn(tokenPayload.expires_in),
    status: "active",
    metadata_json: {
      provider: "tiktok",
      scope: cleanText(tokenPayload.scope),
      avatar_url: cleanText(user.avatar_url),
    },
  });
}

async function handleXOAuthCallback(stateRow, code) {
  const config = getApiConfig();
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: config.xClientId,
    redirect_uri: getSocialOAuthRedirectUri("x"),
    code_verifier: cleanText(stateRow.pkce_verifier),
  });
  const basic = Buffer.from(`${config.xClientId}:${config.xClientSecret}`).toString("base64");
  const tokenPayload = await fetchJsonOrThrow("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "authorization": `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  }, "X token exchange failed");
  const accessToken = cleanText(tokenPayload.access_token);
  const me = accessToken
    ? await fetchJsonOrThrow("https://api.twitter.com/2/users/me?user.fields=username,name,profile_image_url", {
        headers: { Authorization: `Bearer ${accessToken}` },
      }, "X user request failed")
    : null;
  const user = me?.data || {};
  return await upsertCreatorSocialConnection(stateRow.discord_user_id, "x", {
    external_account_id: cleanText(user.id),
    external_account_name: cleanText(user.username) || cleanText(user.name) || cleanText(user.id),
    access_token: accessToken,
    refresh_token: cleanText(tokenPayload.refresh_token),
    token_expires_at: isoFromExpiresIn(tokenPayload.expires_in),
    status: "active",
    metadata_json: {
      provider: "x",
      name: cleanText(user.name),
      profile_image_url: cleanText(user.profile_image_url),
      scope: cleanText(tokenPayload.scope),
    },
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function socialCallbackHtml({ platform, ok, title, message }) {
  const safePlatform = platformDisplayNameForError(cleanText(platform) || "social");
  const safeTitle = escapeHtml(cleanText(title) || (ok ? `${safePlatform} connected` : `${safePlatform} connection failed`));
  const safeMessage = escapeHtml(cleanText(message) || (ok ? "You can return to WatchMe." : "Return to WatchMe and try again."));
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>WatchMe ${safePlatform}</title></head><body style="font-family:system-ui;background:#07101f;color:#eef4ff;padding:32px;line-height:1.5"><main style="max-width:620px;margin:auto"><h1>${safeTitle}</h1><p>${safeMessage}</p><p style="color:#9fb0c8">You can close this tab and return to the WatchMe app or dashboard.</p></main></body></html>`;
}

async function handleSocialOAuthCallback(req, res, url) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }
  const state = cleanText(url.searchParams.get("state"));
  const code = cleanText(url.searchParams.get("code"));
  const providerError = cleanText(url.searchParams.get("error_description")) || cleanText(url.searchParams.get("error"));
  let platform = "social";
  let ok = false;
  let title = "";
  let message = "";
  try {
    if (!state) throw new Error("Missing OAuth state.");
    const consumed = await consumeSocialOAuthState(state);
    if (!consumed.ok) throw new Error(consumed.error || "OAuth state is invalid.");
    const stateRow = consumed.state;
    platform = cleanText(stateRow.platform) || platform;
    if (providerError) throw new Error(providerError);
    if (!code) throw new Error("OAuth code was not returned.");

    let saved = null;
    if (platform === "facebook" || platform === "instagram") {
      saved = await handleMetaOAuthCallback(platform, stateRow, code);
      if (saved?.status === "pending_selection") {
        title = `${platformDisplayNameForError(platform)} Page selection needed`;
        message = "Return to WatchMe and choose the Page to connect.";
      }
    } else if (platform === "tiktok") {
      saved = await handleTikTokOAuthCallback(stateRow, code);
    } else if (platform === "x") {
      saved = await handleXOAuthCallback(stateRow, code);
    } else {
      throw new Error(`${platformDisplayNameForError(platform)} OAuth callback is not available yet.`);
    }
    ok = true;
    title = title || `${platformDisplayNameForError(platform)} connected`;
    message = message || `${platformDisplayNameForError(platform)} is now connected to WatchMe Pro.`;
  } catch (error) {
    title = `${platformDisplayNameForError(platform)} connection failed`;
    message = error.message || "OAuth connection failed.";
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(socialCallbackHtml({ platform, ok, title, message }));
}

async function handleSocialConnectionDisconnect(req, res, platform) {
  if (req.method !== "DELETE") {
    return sendMethodNotAllowed(res);
  }
  const normalizedPlatform = cleanText(platform).toLowerCase();
  const authorized = getAuthorizedMobileRequestUser(req);
  if (!authorized.ok) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }
  try {
    const result = await deleteCreatorSocialConnection(authorized.discordUserId, normalizedPlatform);
    return sendJson(res, 200, result);
  } catch (error) {
    return sendBadRequest(res, error.message || "Unable to disconnect social account");
  }
}

async function handleMetaPageSelection(req, res, platform) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }
  const normalizedPlatform = cleanText(platform).toLowerCase();
  if (normalizedPlatform !== "facebook" && normalizedPlatform !== "instagram") {
    return sendBadRequest(res, "Page selection is only available for Meta connections");
  }
  const authorized = getAuthorizedMobileRequestUser(req);
  if (!authorized.ok) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  try {
    const body = await readJsonBody(req);
    const pageId = cleanText(body.page_id);
    if (!pageId) throw new Error("page_id is required.");
    const pending = await getCreatorSocialConnectionForOAuth(authorized.discordUserId, normalizedPlatform);
    if (!pending || pending.status !== "pending_selection" || !pending.access_token) {
      throw new Error("No pending Page selection was found.");
    }
    const options = Array.isArray(pending.metadata_json?.page_options)
      ? pending.metadata_json.page_options
      : [];
    if (!options.some((option) => cleanText(option.id) === pageId)) {
      throw new Error("Selected Page is not available for this connection.");
    }
    const page = await fetchMetaPageDetails(pageId, pending.access_token);
    const saved = await saveMetaConnectionFromPage(
      authorized.discordUserId,
      normalizedPlatform,
      page,
      cleanMetadataObject(pending.metadata_json)
    );
    return sendJson(res, 200, { ok: true, connection: saved });
  } catch (error) {
    return sendBadRequest(res, error.message || "Unable to save Page selection");
  }
}

function getCreatorPostTemplatePatch(body = {}) {
  const requestedPlatforms = normalizeStringArray(body.target_platforms_json)
    .map((platform) => platform.toLowerCase())
    .filter((platform) => POST_BUILDER_PLATFORMS.includes(platform));

  return {
    template_id: body.template_id ? Number(body.template_id) : null,
    name: cleanText(body.name) || "Quick post",
    post_text: cleanText(body.post_text) || "",
    link_url: cleanText(body.link_url),
    media_urls_json: normalizeMediaUrls(body.media_urls_json),
    target_platforms_json: requestedPlatforms,
    is_default: toBoolean(body.is_default, false),
  };
}

async function handleCreatorPostBuilder(req, res, discordUserId) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  const authorized = getAuthorizedMobileUser(req, discordUserId);
  if (!authorized.ok) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const state = await getCreatorPostBuilderState(discordUserId);
  return sendJson(res, 200, {
    ok: true,
    discord_user_id: discordUserId,
    ...state,
  });
}

async function handleCreatorPostTemplate(req, res, discordUserId) {
  if (req.method === "GET") {
    const templates = await getCreatorPostTemplates(discordUserId);
    return sendJson(res, 200, {
      ok: true,
      discord_user_id: discordUserId,
      templates,
    });
  }

  if (req.method !== "PUT" && req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  const authorized = getAuthorizedMobileUser(req, discordUserId);
  if (!authorized.ok) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  let patch;
  try {
    const body = await readJsonBody(req);
    patch = getCreatorPostTemplatePatch(body);
  } catch (error) {
    return sendBadRequest(res, error.message || "Invalid template payload");
  }
  const saved = await saveCreatorPostTemplate(discordUserId, patch);

  return sendJson(res, 200, {
    ok: true,
    template: saved,
  });
}

async function handleCreatorSocialConnection(req, res, discordUserId, platform) {
  if (req.method !== "PUT" && req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  const authorized = getAuthorizedMobileUser(req, discordUserId);
  if (!authorized.ok) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  let patch;
  try {
    const body = await readJsonBody(req);
    patch = getCreatorSocialConnectionPatch(platform, body);
  } catch (error) {
    return sendBadRequest(res, error.message || "Invalid social connection payload");
  }

  const saved = await upsertCreatorSocialConnection(discordUserId, platform, patch);
  return sendJson(res, 200, {
    ok: true,
    connection: saved,
  });
}

async function handleCreatorPostPublish(req, res, discordUserId) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  const authorized = getAuthorizedMobileUser(req, discordUserId);
  if (!authorized.ok) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const body = await readJsonBody(req);
  const requestedPlatforms = normalizeStringArray(body.target_platforms_json);
  let targetPlatforms = Array.from(new Set(
    requestedPlatforms
      .map((platform) => platform.toLowerCase())
      .filter((platform) => POST_BUILDER_PLATFORMS.includes(platform))
  ));

  if (!targetPlatforms.length || requestedPlatforms.some((platform) => platform.toLowerCase() === "all")) {
    targetPlatforms = (await getActiveCreatorSocialPlatforms(discordUserId))
      .map((platform) => String(platform || "").trim().toLowerCase())
      .filter((platform) => POST_BUILDER_PLATFORMS.includes(platform));
  }

  if (!targetPlatforms.length) {
    return sendBadRequest(res, "Connect at least one social page before scheduling automation");
  }

  let scheduledAt = null;
  try {
    scheduledAt = normalizeScheduledAt(body.scheduled_at || body.scheduledAt);
  } catch (error) {
    return sendBadRequest(res, error.message || "Invalid scheduled_at");
  }

  const mediaUrls = normalizeMediaUrls(body.media_urls_json);
  const payload = {
    post_text: cleanText(body.post_text) || "",
    link_url: cleanText(body.link_url),
    media_urls_json: mediaUrls,
    target_platforms_json: targetPlatforms,
    scheduled_at: scheduledAt,
    template_name: cleanText(body.template_name),
    metadata_json: {
      ...(typeof body.metadata_json === "object" && body.metadata_json !== null
        ? body.metadata_json
        : {}),
      media_summary: summarizeMediaUrls(mediaUrls),
    },
  };

  const dispatch = await createCreatorPostDispatch(discordUserId, {
    template_id: body.template_id ? Number(body.template_id) : null,
    status: scheduledAt ? "scheduled" : "queued",
    scheduled_at: scheduledAt,
    target_platforms_json: targetPlatforms,
    payload_json: payload,
  });

  await enqueueSocialPostDispatch(discordUserId, dispatch.dispatch_id, {
    targetPlatforms,
    templateId: dispatch.template_id,
    payload,
  }, scheduledAt);

  await recordAutomationActivityAndPush(discordUserId, {
    event_type: scheduledAt ? "post.scheduled" : "post.queued",
    title: scheduledAt ? "Scheduled post queued" : "Post queued",
    body: scheduledAt
      ? `Scheduled for ${scheduledAt}`
      : `Sending to ${targetPlatforms.join(", ")}`,
    severity: "info",
    dispatch_id: dispatch.dispatch_id,
    source_type: "dispatch",
    source_key: `${scheduledAt ? "scheduled" : "queued"}:${dispatch.dispatch_id}`,
    metadata_json: {
      target_platforms: targetPlatforms,
      scheduled_at: scheduledAt,
    },
  });

  return sendJson(res, 202, {
    ok: true,
    dispatch,
  });
}

async function handleMobileDevices(req, res) {
  const authorized = getAuthorizedMobileRequestUser(req);
  if (!authorized.ok) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
      const device = await registerMobilePushDevice(authorized.discordUserId, body);
      return sendJson(res, 200, { ok: true, device });
    } catch (error) {
      return sendBadRequest(res, error.message || "Invalid device payload");
    }
  }

  if (req.method === "DELETE") {
    const body = await readJsonBody(req).catch(() => ({}));
    const token = cleanText(body.push_token || body.pushToken || req.headers["x-watchme-push-token"]);
    if (!token) {
      return sendBadRequest(res, "push_token is required");
    }
    const device = await disableMobilePushDevice(authorized.discordUserId, token);
    return sendJson(res, 200, { ok: true, device });
  }

  return sendMethodNotAllowed(res);
}

async function handleAutomationHome(req, res) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  const authorized = getAuthorizedMobileRequestUser(req);
  if (!authorized.ok) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const home = await getAutomationHome(authorized.discordUserId, {
    pushConfigured: isFirebasePushConfigured(),
  });
  return sendJson(res, 200, {
    ok: true,
    discord_user_id: authorized.discordUserId,
    ...home,
  });
}

async function handleAutomationActivity(req, res, url) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  const authorized = getAuthorizedMobileRequestUser(req);
  if (!authorized.ok) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const limit = toInteger(url.searchParams.get("limit"), 50);
  const cursor = toInteger(url.searchParams.get("cursor"), 0);
  const activity = await listAutomationActivity(authorized.discordUserId, { limit, cursor });
  return sendJson(res, 200, {
    ok: true,
    discord_user_id: authorized.discordUserId,
    ...activity,
  });
}

async function handleCreatorScheduledDispatches(req, res, discordUserId, url) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  const authorized = getAuthorizedMobileUser(req, discordUserId);
  if (!authorized.ok) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const scheduled = await listScheduledCreatorDispatches(discordUserId, {
    limit: toInteger(url.searchParams.get("limit"), 50),
    includePast: toBoolean(url.searchParams.get("include_past"), false),
  });
  return sendJson(res, 200, {
    ok: true,
    discord_user_id: discordUserId,
    scheduled,
  });
}

async function handleDispatchRepost(req, res, dispatchId) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  const authorized = getAuthorizedMobileRequestUser(req);
  if (!authorized.ok) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const original = await getCreatorDispatchForUser(authorized.discordUserId, dispatchId);
  if (!original) {
    return sendNotFound(res, "Dispatch not found");
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendBadRequest(res, error.message || "Invalid repost payload");
  }

  const mode = cleanText(body.mode || "now").toLowerCase();
  if (!["now", "schedule"].includes(mode)) {
    return sendBadRequest(res, "mode must be now or schedule");
  }

  let scheduledAt = null;
  if (mode === "schedule") {
    try {
      scheduledAt = normalizeScheduledAt(body.scheduled_at || body.scheduledAt);
    } catch (error) {
      return sendBadRequest(res, error.message || "Invalid scheduled_at");
    }
    if (!scheduledAt) {
      return sendBadRequest(res, "scheduled_at is required for scheduled reposts");
    }
  }

  const requestedPlatforms = normalizeStringArray(body.target_platforms_json)
    .map((platform) => platform.toLowerCase())
    .filter((platform) => POST_BUILDER_PLATFORMS.includes(platform));
  const targetPlatforms = requestedPlatforms.length
    ? requestedPlatforms
    : Array.isArray(original.target_platforms_json)
      ? original.target_platforms_json
      : [];
  if (!targetPlatforms.length) {
    return sendBadRequest(res, "At least one target platform is required");
  }

  const payload = {
    ...(original.payload_json || {}),
    metadata_json: {
      ...((original.payload_json || {}).metadata_json || {}),
      repost_of_dispatch_id: original.dispatch_id,
      repost_mode: mode,
    },
  };

  const dispatch = await createCreatorPostDispatch(authorized.discordUserId, {
    template_id: original.template_id || null,
    status: scheduledAt ? "scheduled" : "queued",
    scheduled_at: scheduledAt,
    source_type: "repost",
    source_key: `repost:${original.dispatch_id}:${scheduledAt || Date.now()}`,
    target_platforms_json: targetPlatforms,
    payload_json: payload,
  });

  await enqueueSocialPostDispatch(authorized.discordUserId, dispatch.dispatch_id, {
    targetPlatforms,
    templateId: dispatch.template_id,
    payload,
  }, scheduledAt);

  await recordAutomationActivityAndPush(authorized.discordUserId, {
    event_type: scheduledAt ? "post.repost_scheduled" : "post.repost_queued",
    title: scheduledAt ? "Repost scheduled" : "Repost queued",
    body: scheduledAt ? `Scheduled for ${scheduledAt}` : `Sending again to ${targetPlatforms.join(", ")}`,
    severity: "info",
    dispatch_id: dispatch.dispatch_id,
    source_type: "dispatch",
    source_key: `repost:${dispatch.dispatch_id}`,
    metadata_json: {
      original_dispatch_id: original.dispatch_id,
      target_platforms: targetPlatforms,
      scheduled_at: scheduledAt,
    },
  });

  return sendJson(res, 202, {
    ok: true,
    dispatch,
  });
}

function buildMobileProfilePayload({ discordUserId, state, guilds, entitlement, user }) {
  const identity = state?.identity || {};
  const displayName =
    identity?.display_name ||
    user?.username ||
    null;
  const avatarUrl =
    identity?.avatar_url ||
    user?.avatar_url ||
    null;
  const profile = {
    ...(identity || {}),
    discord_user_id: discordUserId,
    display_name: displayName,
    discord_username: identity?.discord_username || user?.username || null,
    avatar_url: avatarUrl,
    verified_pro: Boolean(entitlement?.active),
    entitlement,
    membership: {
      plan: entitlement?.active ? "WatchMe Pro" : "WatchMe Lite",
      status: entitlement?.status || (entitlement?.active ? "active" : "none"),
    },
    identity: {
      ...(identity || {}),
      discord_user_id: discordUserId,
      display_name: displayName,
      discord_username: identity?.discord_username || user?.username || null,
      avatar_url: avatarUrl,
    },
    guilds,
    manageable_guilds: guilds,
    socials: Array.isArray(state?.connections) ? state.connections : [],
    templates: Array.isArray(state?.templates) ? state.templates : [],
  };

  return profile;
}

async function handleMobileProfile(req, res) {
  const authorized = getAuthorizedMobileRequestUser(req);
  if (!authorized.ok) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  if (req.method === "PUT") {
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendBadRequest(res, error.message || "Invalid profile payload");
    }
    await saveCreatorIdentity(authorized.discordUserId, getCreatorProfilePatch(body));
  } else if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  const entitlementOptions = getInternalWorkspaceOptions();
  const [entitlement, state, guilds, user] = await Promise.all([
    getMemberEntitlement(authorized.discordUserId, entitlementOptions),
    getCreatorPostBuilderState(authorized.discordUserId),
    getMemberGuilds(authorized.discordUserId, { entitlementOptions }),
    getUser(authorized.discordUserId),
  ]);

  const profile = buildMobileProfilePayload({
    discordUserId: authorized.discordUserId,
    state,
    guilds,
    entitlement,
    user,
  });

  return sendJson(res, 200, {
    ok: true,
    discord_user_id: authorized.discordUserId,
    profile,
    ...profile,
  });
}

async function getAuthorizedMobileGuild(req, guildId) {
  const authorized = getAuthorizedMobileRequestUser(req);
  if (!authorized.ok) {
    return authorized;
  }

  const guilds = await getMemberGuilds(authorized.discordUserId, {
    entitlementOptions: getInternalWorkspaceOptions(),
  });
  const hasAccess = guilds.some((guild) => String(guild.guild_id) === String(guildId));
  if (!hasAccess) {
    return {
      ok: false,
      code: "guild_forbidden",
      discordUserId: authorized.discordUserId,
    };
  }

  return {
    ...authorized,
    guilds,
  };
}

async function handleMobileGuildWorkspace(req, res, guildId) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  const authorized = await getAuthorizedMobileGuild(req, guildId);
  if (!authorized.ok) {
    return sendJson(res, authorized.code === "guild_forbidden" ? 403 : 401, {
      error: authorized.code === "guild_forbidden" ? "Guild access denied" : "Unauthorized",
    });
  }

  const workspace = await getGuildWorkspaceSnapshot(authorized.discordUserId, guildId);
  return sendJson(res, 200, {
    ok: true,
    discord_user_id: authorized.discordUserId,
    guild_id: guildId,
    workspace,
  });
}

async function handleMobileGuildConfig(req, res, guildId) {
  if (req.method !== "PUT" && req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  const authorized = await getAuthorizedMobileGuild(req, guildId);
  if (!authorized.ok) {
    return sendJson(res, authorized.code === "guild_forbidden" ? 403 : 401, {
      error: authorized.code === "guild_forbidden" ? "Guild access denied" : "Unauthorized",
    });
  }

  try {
    await assertOrBindBillingProGuild(
      authorized.discordUserId,
      guildId,
      getInternalWorkspaceOptions(),
    );
  } catch (error) {
    if (error.code === "PRO_GUILD_LOCKED" || error.code === "PRO_GUILD_SLOT_TAKEN") {
      return sendJson(res, 403, { error: error.message });
    }
    if (error.code === "guild_forbidden") {
      return sendJson(res, 403, { error: error.message });
    }
    throw error;
  }

  const current = (await getGuildConfig(guildId)) || {};
  const body = await readJsonBody(req);
  const next = getGuildConfigPatch(body, current);
  const saved = await upsertGuildConfig(guildId, next);
  const subscriptions = await syncGuildPlatformSubscriptions(guildId, saved);

  for (const subscription of subscriptions) {
    await enqueuePlatformSubscriptionRenewal(subscription.platform, subscription.topic_key, {
      guildId,
      subscriptionId: subscription.subscription_id,
      scope: "guild",
      metadata: subscription.metadata_json || {},
    });
  }

  const workspace = await getGuildWorkspaceSnapshot(authorized.discordUserId, guildId);
  return sendJson(res, 200, {
    ok: true,
    discord_user_id: authorized.discordUserId,
    guild_id: guildId,
    config: saved,
    subscriptions,
    workspace,
  });
}

async function handleInternalMobileSessionIssue(req, res) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const config = getApiConfig();
  if (!config.mobileSessionSecret) {
    return sendBadRequest(res, "Mobile session signing is not configured");
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendBadRequest(res, error.message || "Invalid mobile session payload");
  }

  const discordUserId = cleanText(body.discord_user_id);
  if (!discordUserId) {
    return sendBadRequest(res, "discord_user_id is required");
  }

  const session = issueMobileSession({
    discordUserId,
    secret: config.mobileSessionSecret,
    ttlSeconds: toInteger(body.ttl_seconds, config.mobileSessionTtlSeconds),
  });

  return sendJson(res, 201, {
    ok: true,
    session,
  });
}

async function handleMobileDiscordSession(req, res) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  const config = getApiConfig();
  if (!config.mobileSessionSecret) {
    return sendBadRequest(res, "Mobile session signing is not configured");
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendBadRequest(res, error.message || "Invalid Discord session payload");
  }

  const accessToken = cleanText(body.access_token || body.accessToken);
  if (!accessToken) {
    return sendBadRequest(res, "access_token is required");
  }

  let user;
  let guilds = [];
  try {
    user = await fetchDiscordOAuthJson("/users/@me", accessToken);
    guilds = await fetchDiscordOAuthJson("/users/@me/guilds", accessToken);
  } catch (error) {
    return sendJson(res, 401, {
      error: "Discord authorization failed",
      detail: error.message || "Unable to verify Discord account",
    });
  }

  const discordUserId = cleanText(user?.id);
  if (!discordUserId) {
    return sendJson(res, 401, { error: "Discord authorization failed" });
  }

  const manageableGuilds = getManageableDiscordGuilds(guilds);
  await syncMemberWorkspaceState({
    discordUserId,
    username: cleanText(user.global_name || user.username),
    avatarUrl: getDiscordAvatarUrl(user),
    manageableGuilds,
  });
  await saveCreatorIdentity(discordUserId, {
    display_name: cleanText(user.global_name || user.username),
  });

  const session = issueMobileSession({
    discordUserId,
    secret: config.mobileSessionSecret,
    ttlSeconds: toInteger(body.ttl_seconds, config.mobileSessionTtlSeconds),
  });
  const entitlement = await getMemberEntitlement(discordUserId, getInternalWorkspaceOptions());

  return sendJson(res, 201, {
    ok: true,
    session,
    user: {
      id: discordUserId,
      username: cleanText(user.username),
      global_name: cleanText(user.global_name),
      avatar_url: getDiscordAvatarUrl(user),
    },
    guild_count: Array.isArray(guilds) ? guilds.length : 0,
    manageable_guild_count: manageableGuilds.length,
    entitlement,
  });
}

async function handleInternalQueueOps(req, res) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const config = getApiConfig();
  const stats = await getQueueStats({
    lockTimeoutSeconds: config.workerLockTimeoutSeconds,
    backlogWarningSeconds: config.opsBacklogWarningSeconds,
    leaseWarningSeconds: config.opsLeaseWarningSeconds,
    workerHeartbeatWarningSeconds: config.opsWorkerHeartbeatWarningSeconds,
    workerRssWarningBytes: config.opsWorkerRssWarningBytes,
    workerHeapWarningBytes: config.opsWorkerHeapWarningBytes,
    workerRestartStormWindowSeconds: config.opsWorkerRestartStormWindowSeconds,
    workerRestartStormMinCount: config.opsWorkerRestartStormMinCount,
    pagerDeliveryFailWindowSeconds: config.opsPagerDeliveryFailWindowSeconds,
    pagerDeliveryFailMinCount: config.opsPagerDeliveryFailMinCount,
  });
  return sendJson(res, 200, {
    ok: true,
    ...stats,
  });
}

async function handleInternalPagingStatus(req, res) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const config = getApiConfig();
  const snapshot = await getPagerStatus({
    config,
    includeResolved: true,
  });

  return sendJson(res, 200, {
    ok: true,
    ...snapshot,
  });
}

async function handleInternalPagingRun(req, res) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const config = getApiConfig();
  let body = {};
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendBadRequest(res, error.message || "Invalid pager payload");
  }

  const dryRun = toBoolean(body.dry_run, false);
  const warningOverrides = Array.isArray(body.warning_overrides) ? body.warning_overrides : null;

  if (warningOverrides && config.nodeEnv === "production") {
    return sendBadRequest(res, "warning_overrides are only allowed outside production");
  }

  let result;
  try {
    result = await runPagerSweep({
      config,
      warningOverrides,
      dryRun,
    });
  } catch (error) {
    return sendBadRequest(res, error.message || "Pager sweep failed");
  }

  return sendJson(res, dryRun ? 200 : 202, {
    ok: true,
    ...result,
  });
}

async function handleInternalWorkspaceSync(req, res) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return sendBadRequest(res, error.message || "Invalid workspace sync payload");
  }

  const user = body?.user && typeof body.user === "object" ? body.user : null;
  const discordUserId = cleanText(user?.id || body?.discord_user_id);
  if (!discordUserId) {
    return sendBadRequest(res, "discord_user_id is required");
  }

  const username =
    cleanText(user?.global_name) ||
    cleanText(user?.username) ||
    cleanText(user?.display_name) ||
    cleanText(body?.username) ||
    null;
  const avatarUrl =
    cleanText(user?.avatar_url) ||
    cleanText(body?.avatar_url) ||
    null;
  const manageableGuilds = Array.isArray(body?.manageable_guilds) ? body.manageable_guilds : [];

  const sync = await syncMemberWorkspaceState({
    discordUserId,
    username,
    avatarUrl,
    manageableGuilds,
  });

  return sendJson(res, 200, {
    ok: true,
    sync,
  });
}

async function handleInternalMe(req, res) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const discordUserId = getInternalDiscordUserId(req);
  if (!discordUserId) {
    return sendBadRequest(res, "Missing x-discord-user-id");
  }

  const [entitlement, state] = await Promise.all([
    getMemberEntitlement(discordUserId, getInternalWorkspaceOptions()),
    getCreatorPostBuilderState(discordUserId),
  ]);

  return sendJson(res, 200, {
    ok: true,
    discord_user_id: discordUserId,
    entitlement,
    profile: state.identity,
    socials: state.connections,
  });
}

async function handleInternalGuilds(req, res) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const discordUserId = getInternalDiscordUserId(req);
  if (!discordUserId) {
    return sendBadRequest(res, "Missing x-discord-user-id");
  }

  const guilds = await getMemberGuilds(discordUserId, {
    entitlementOptions: getInternalWorkspaceOptions(),
  });
  return sendJson(res, 200, {
    ok: true,
    guilds,
  });
}

async function handleInternalWorkspace(req, res, guildId) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const discordUserId = getInternalDiscordUserId(req);
  if (!discordUserId) {
    return sendBadRequest(res, "Missing x-discord-user-id");
  }

  const workspace = await getGuildWorkspaceSnapshot(discordUserId, guildId);
  return sendJson(res, 200, {
    ok: true,
    workspace,
  });
}

async function handleInternalTemplates(req, res) {
  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const discordUserId = getInternalDiscordUserId(req);
  if (!discordUserId) {
    return sendBadRequest(res, "Missing x-discord-user-id");
  }

  if (req.method === "GET") {
    const templates = await getCreatorPostTemplates(discordUserId);
    return sendJson(res, 200, {
      ok: true,
      templates,
    });
  }

  if (req.method !== "POST" && req.method !== "PUT") {
    return sendMethodNotAllowed(res);
  }

  const body = await readJsonBody(req);
  const template = await saveCreatorPostTemplate(discordUserId, getCreatorPostTemplatePatch(body));
  return sendJson(res, 200, {
    ok: true,
    template,
  });
}

async function handleInternalSocialOAuthStart(req, res) {
  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }
  const discordUserId = getInternalDiscordUserId(req);
  if (!discordUserId) {
    return sendBadRequest(res, "Missing x-discord-user-id");
  }

  try {
    const body = await readJsonBody(req);
    const platform = cleanText(body.platform).toLowerCase();
    return sendJson(res, 200, await createSocialOAuthStartPayload(
      discordUserId,
      platform,
      "web",
      req.headers["user-agent"]
    ));
  } catch (error) {
    return sendBadRequest(res, error.message || "Unable to start social OAuth");
  }
}

async function handleInternalSocialConnections(req, res) {
  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }
  const discordUserId = getInternalDiscordUserId(req);
  if (!discordUserId) {
    return sendBadRequest(res, "Missing x-discord-user-id");
  }
  const connections = await getCreatorSocialConnections(discordUserId);
  return sendJson(res, 200, { ok: true, discord_user_id: discordUserId, connections });
}

async function handleInternalSocialConnectionDisconnect(req, res, platform) {
  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }
  if (req.method !== "DELETE") {
    return sendMethodNotAllowed(res);
  }
  const discordUserId = getInternalDiscordUserId(req);
  if (!discordUserId) {
    return sendBadRequest(res, "Missing x-discord-user-id");
  }
  try {
    return sendJson(res, 200, await deleteCreatorSocialConnection(discordUserId, cleanText(platform).toLowerCase()));
  } catch (error) {
    return sendBadRequest(res, error.message || "Unable to disconnect social account");
  }
}

async function handleInternalMetaPageSelection(req, res, platform) {
  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }
  const discordUserId = getInternalDiscordUserId(req);
  if (!discordUserId) {
    return sendBadRequest(res, "Missing x-discord-user-id");
  }
  const normalizedPlatform = cleanText(platform).toLowerCase();
  try {
    const body = await readJsonBody(req);
    const pageId = cleanText(body.page_id);
    if (!pageId) throw new Error("page_id is required.");
    const pending = await getCreatorSocialConnectionForOAuth(discordUserId, normalizedPlatform);
    if (!pending || pending.status !== "pending_selection" || !pending.access_token) {
      throw new Error("No pending Page selection was found.");
    }
    const options = Array.isArray(pending.metadata_json?.page_options)
      ? pending.metadata_json.page_options
      : [];
    if (!options.some((option) => cleanText(option.id) === pageId)) {
      throw new Error("Selected Page is not available for this connection.");
    }
    const page = await fetchMetaPageDetails(pageId, pending.access_token);
    const saved = await saveMetaConnectionFromPage(
      discordUserId,
      normalizedPlatform,
      page,
      cleanMetadataObject(pending.metadata_json)
    );
    return sendJson(res, 200, { ok: true, connection: saved });
  } catch (error) {
    return sendBadRequest(res, error.message || "Unable to save Page selection");
  }
}

async function handleInternalAutomationHome(req, res) {
  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }
  const discordUserId = getInternalDiscordUserId(req);
  if (!discordUserId) {
    return sendBadRequest(res, "Missing x-discord-user-id");
  }
  const home = await getAutomationHome(discordUserId, {
    pushConfigured: isFirebasePushConfigured(),
  });
  return sendJson(res, 200, { ok: true, discord_user_id: discordUserId, ...home });
}

async function handleInternalAutomationActivity(req, res, url) {
  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }
  const discordUserId = getInternalDiscordUserId(req);
  if (!discordUserId) {
    return sendBadRequest(res, "Missing x-discord-user-id");
  }
  const activity = await listAutomationActivity(discordUserId, {
    limit: toInteger(url.searchParams.get("limit"), 50),
    cursor: toInteger(url.searchParams.get("cursor"), 0),
  });
  return sendJson(res, 200, { ok: true, discord_user_id: discordUserId, ...activity });
}

async function handleInternalScheduledDispatches(req, res, url) {
  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }
  const discordUserId = getInternalDiscordUserId(req);
  if (!discordUserId) {
    return sendBadRequest(res, "Missing x-discord-user-id");
  }
  const scheduled = await listScheduledCreatorDispatches(discordUserId, {
    limit: toInteger(url.searchParams.get("limit"), 50),
    includePast: toBoolean(url.searchParams.get("include_past"), false),
  });
  return sendJson(res, 200, { ok: true, discord_user_id: discordUserId, scheduled });
}

async function handlePlatformEventIngest(req, res) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  let eventPatch;
  try {
    const body = await readJsonBody(req);
    eventPatch = getPlatformEventPatch(body);
  } catch (error) {
    return sendBadRequest(res, error.message || "Invalid platform event payload");
  }

  const event = await ingestPlatformEvent(eventPatch);
  const job = await enqueuePlatformEventIngest({
    eventId: event.event_id,
    platform: event.platform,
    eventType: event.event_type,
    sourceKey: event.source_key,
    sourceExternalId: event.source_external_id,
    sourceCreatedAt: event.source_created_at,
    providerEventId: eventPatch.provider_event_id,
  });

  return sendJson(res, 202, {
    ok: true,
    event,
    job,
  });
}

async function handleSocialEventEvaluation(req, res) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  let candidate;
  try {
    const body = await readJsonBody(req);
    candidate = getSocialCandidatePatch(body);
  } catch (error) {
    return sendBadRequest(res, error.message || "Invalid social candidate payload");
  }

  const evaluation = await evaluateSocialOriginCandidate(candidate);
  return sendJson(res, 200, {
    ok: true,
    candidate,
    ...evaluation,
  });
}

async function ingestSocialEventBody(body = {}, patchBuilder = getSocialEventIngestPatch) {
  const next = patchBuilder(body);
  const candidate = next.candidate;
  const eventPatch = next.eventPatch;
  const evaluation = await evaluateSocialOriginCandidate(candidate);
  await recordSocialOriginDecision(candidate, evaluation).catch(() => null);
  if (!evaluation.accepted) {
    const matchedUserId = cleanText(evaluation.match?.discord_user_id);
    if (matchedUserId) {
      await recordAutomationActivityAndPush(matchedUserId, {
        event_type: "loop.prevented",
        title: "Loop prevented",
        body: `${candidate.platform || "Social"} post ignored because WatchMe created it.`,
        severity: "info",
        platform: candidate.platform,
        dispatch_id: evaluation.match?.dispatch_id || null,
        publication_id: evaluation.match?.publication_id || null,
        source_type: "loop_prevention",
        source_key: `${candidate.platform || "unknown"}:${candidate.external_post_id || candidate.external_parent_post_id || evaluation.match?.publication_id || Date.now()}`,
        metadata_json: {
          reason: evaluation.reason,
          match: evaluation.match,
        },
      });
    }
    return {
      candidate,
      ingested: false,
      enqueued: false,
      event: null,
      job: null,
      ...evaluation,
    };
  }

  const event = await ingestPlatformEvent(eventPatch);
  const job = await enqueuePlatformEventIngest({
    eventId: event.event_id,
    platform: event.platform,
    eventType: event.event_type,
    sourceKey: event.source_key,
    sourceExternalId: event.source_external_id,
    sourceCreatedAt: event.source_created_at,
  });

  return {
    candidate,
    ingested: true,
    enqueued: true,
    event,
    job,
    ...evaluation,
  };
}

async function handleSocialEventIngest(req, res) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  let result;
  try {
    const body = await readJsonBody(req);
    result = await ingestSocialEventBody(body);
  } catch (error) {
    return sendBadRequest(res, error.message || "Invalid social ingest payload");
  }

  return sendJson(res, 202, {
    ok: true,
    ...result,
  });
}

async function handleInstagramMediaAdapter(req, res) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  if (!isInternalAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  let normalized;
  let result;
  try {
    const body = await readJsonBody(req);
    normalized = normalizeInstagramMediaAdapterBody(body);
    result = await ingestSocialEventBody(normalized);
  } catch (error) {
    return sendBadRequest(res, error.message || "Invalid Instagram adapter payload");
  }

  return sendJson(res, 202, {
    ok: true,
    adapter: "instagram_media",
    normalized,
    ...result,
  });
}

async function handleGuildConfig(req, res, guildId) {
  if (req.method === "GET") {
    const config = await getGuildConfig(guildId);
    return sendJson(res, 200, {
      guild_id: guildId,
      config,
    });
  }

  if (req.method !== "PUT" && req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  if (!isPublicWriteAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const billingDiscordUserId = cleanText(req.headers["x-discord-user-id"]);
  if (billingDiscordUserId) {
    try {
      await assertOrBindBillingProGuild(
        billingDiscordUserId,
        guildId,
        getInternalWorkspaceOptions(),
      );
    } catch (error) {
      if (error.code === "PRO_GUILD_LOCKED" || error.code === "PRO_GUILD_SLOT_TAKEN") {
        return sendJson(res, 403, { error: error.message });
      }
      if (error.code === "guild_forbidden") {
        return sendJson(res, 403, { error: error.message });
      }
      throw error;
    }
  }

  const current = (await getGuildConfig(guildId)) || {};
  const body = await readJsonBody(req);
  const next = getGuildConfigPatch(body, current);
  const saved = await upsertGuildConfig(guildId, next);
  const subscriptions = await syncGuildPlatformSubscriptions(guildId, saved);

  for (const subscription of subscriptions) {
    await enqueuePlatformSubscriptionRenewal(subscription.platform, subscription.topic_key, {
      guildId,
      subscriptionId: subscription.subscription_id,
      scope: "guild",
      metadata: subscription.metadata_json || {},
    });
  }

  return sendJson(res, 200, {
    ok: true,
    config: saved,
    subscriptions,
  });
}

async function handleCreators(req, res, guildId) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  const creators = await getCreatorProfiles(guildId);
  return sendJson(res, 200, {
    guild_id: guildId,
    creators,
  });
}

async function handleMobileGuildCreatorDetail(req, res, guildId, discordUserId) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  const authorized = await getAuthorizedMobileGuild(req, guildId);
  if (!authorized.ok) {
    return sendJson(res, authorized.code === "guild_forbidden" ? 403 : 401, {
      error: authorized.code === "guild_forbidden" ? "Guild access denied" : "Unauthorized",
    });
  }

  const creators = await getCreatorProfiles(guildId);
  const creator = creators.find((item) => String(item.discord_user_id) === String(discordUserId));
  if (!creator) {
    return sendNotFound(res, "Creator not found");
  }

  const [members, roles, channels] = await Promise.all([
    loadGuildDiscordMembers(guildId).catch(() => []),
    loadGuildDiscordRoles(guildId).catch(() => []),
    loadGuildDiscordChannels(guildId).catch(() => []),
  ]);

  const member = members.find((item) => String(item.discord_user_id) === String(discordUserId)) || null;

  return sendJson(res, 200, {
    ok: true,
    guild_id: guildId,
    creator: {
      ...creator,
      avatar_url: member?.avatar_url || "",
      discord_display_name: member?.display_name || null,
      discord_nickname: member?.nickname || "",
    },
    discord: {
      member,
      roles,
      channels,
    },
  });
}

async function handleLiteCapacity(req, res, guildId) {
  if (req.method !== "GET") {
    return sendMethodNotAllowed(res);
  }

  const status = await getLiteCapacityStatus(guildId);
  return sendJson(res, 200, status);
}

async function handleLiteCreators(req, res, guildId) {
  if (req.method === "GET") {
    const [capacity, creators] = await Promise.all([
      getLiteCapacityStatus(guildId),
      getLiteCreators(guildId),
    ]);

    return sendJson(res, 200, {
      ok: true,
      guildId,
      capacity,
      creators,
    });
  }

  if (req.method !== "PUT" && req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  if (!isLiteWriteAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const body = await readJsonBody(req);
  const creator = normalizeLiteCreatorInput(body);
  const validation = validateLiteCreatorInput(creator);

  if (!validation.ok) {
    return sendBadRequest(res, validation.error);
  }

  const capacity = await getLiteCapacityStatus(guildId);
  if (capacity.isFull) {
    return sendJson(res, 409, {
      ok: false,
      code: "LITE_CREATOR_LIMIT_REACHED",
      capacity,
      upgradePrompt: buildLiteUpgradePrompt(capacity),
    });
  }

  const saved = await addLiteCreator(guildId, creator);
  const subscriptions = await syncLitePlatformSubscriptions(guildId);
  const updatedCapacity = await getLiteCapacityStatus(guildId);

  for (const subscription of subscriptions) {
    await enqueuePlatformSubscriptionRenewal(subscription.platform, subscription.topic_key, {
      guildId,
      subscriptionId: subscription.subscription_id,
      scope: "lite",
      metadata: subscription.metadata_json || {},
    });
  }

  return sendJson(res, 200, {
    ok: true,
    creator: saved,
    capacity: updatedCapacity,
    subscriptions,
  });
}

async function handleLiteCreatorDelete(req, res, guildId, liteCreatorId) {
  if (req.method !== "DELETE") {
    return sendMethodNotAllowed(res);
  }

  if (!isLiteWriteAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const removed = await removeLiteCreator(guildId, Number(liteCreatorId));
  if (!removed) {
    return sendNotFound(res, "Lite creator not found");
  }

  const subscriptions = await syncLitePlatformSubscriptions(guildId);

  for (const subscription of subscriptions) {
    await enqueuePlatformSubscriptionRenewal(subscription.platform, subscription.topic_key, {
      guildId,
      subscriptionId: subscription.subscription_id,
      scope: "lite",
      metadata: subscription.metadata_json || {},
    });
  }

  return sendJson(res, 200, {
    ok: true,
    creator: removed,
    capacity: await getLiteCapacityStatus(guildId),
    subscriptions,
  });
}

async function handleLiteChannel(req, res, guildId) {
  if (req.method !== "PUT" && req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  if (!isLiteWriteAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const current = (await getGuildConfig(guildId)) || {};
  const body = await readJsonBody(req);
  const announceChannelId = cleanText(body.announce_channel_id);
  const liveChannelId = cleanText(body.live_channel_id);

  if (!announceChannelId && !liveChannelId) {
    return sendBadRequest(res, "Provide an announce_channel_id or live_channel_id");
  }

  const next = getGuildConfigPatch(
    {
      announce_channel_id: announceChannelId,
      live_channel_id: liveChannelId || announceChannelId,
    },
    current
  );
  const saved = await upsertGuildConfig(guildId, next);

  return sendJson(res, 200, {
    ok: true,
    config: saved,
  });
}

async function handleCreatorProfile(req, res, guildId, discordUserId) {
  if (req.method !== "PUT" && req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  if (!isPublicWriteAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const body = await readJsonBody(req);
  const patch = getCreatorProfilePatch(body);
  const saved = await saveCreatorProfile(guildId, discordUserId, patch);
  const subscriptions = await syncCreatorPlatformSubscriptions(guildId, discordUserId, saved);

  for (const subscription of subscriptions) {
    await enqueuePlatformSubscriptionRenewal(subscription.platform, subscription.topic_key, {
      guildId,
      discordUserId,
      subscriptionId: subscription.subscription_id,
      scope: "creator",
      metadata: subscription.metadata_json || {},
    });
  }

  return sendJson(res, 200, {
    ok: true,
    creator: saved,
    subscriptions,
  });
}

async function handleMobileCreatorProfile(req, res, guildId, discordUserId) {
  if (req.method !== "PUT" && req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  const authorized = getAuthorizedMobileRequestUser(req);
  if (!authorized.ok) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const body = await readJsonBody(req);
  const patch = getCreatorProfilePatch(body);
  const saved = await saveCreatorProfile(guildId, discordUserId, patch);

  const requestedStatus = cleanText(body.status)?.toLowerCase();
  let access = null;
  if (["pending", "approved", "disabled"].includes(requestedStatus || "")) {
    access = await updateCreatorAccess(guildId, discordUserId, {
      status: requestedStatus,
      approved_by: authorized.discordUserId,
      approved_at: requestedStatus === "approved" ? new Date().toISOString() : null,
    });
  }

  const subscriptions = await syncCreatorPlatformSubscriptions(guildId, discordUserId, saved);

  for (const subscription of subscriptions) {
    await enqueuePlatformSubscriptionRenewal(subscription.platform, subscription.topic_key, {
      guildId,
      discordUserId,
      subscriptionId: subscription.subscription_id,
      scope: "creator",
      metadata: subscription.metadata_json || {},
    });
  }

  return sendJson(res, 200, {
    ok: true,
    creator: {
      ...saved,
      access_status: access?.status || requestedStatus || "pending",
    },
    access,
    subscriptions,
  });
}

async function handleCreatorAccess(req, res, guildId, discordUserId) {
  if (req.method !== "PUT" && req.method !== "POST") {
    return sendMethodNotAllowed(res);
  }

  if (!isPublicWriteAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const body = await readJsonBody(req);
  const status = cleanText(body.status)?.toLowerCase();

  if (!["pending", "approved", "disabled"].includes(status || "")) {
    return sendBadRequest(res, "Invalid creator access status");
  }

  const saved = await updateCreatorAccess(guildId, discordUserId, {
    status,
    approved_by: cleanText(body.approved_by),
    approved_at: status === "approved" ? new Date().toISOString() : null,
  });

  return sendJson(res, 200, {
    ok: true,
    access: saved,
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const path = url.pathname;
      let match;

      if (req.method === "GET" && path === "/api/health") {
        return sendJson(res, 200, { ok: true, service: "watchme-v2-api" });
      }

      if (path === "/api/internal/ops/queues") {
        return handleInternalQueueOps(req, res);
      }

      if (path === "/api/internal/ops/health") {
        return handleInternalQueueOps(req, res);
      }

      if (path === "/api/internal/ops/paging") {
        return handleInternalPagingStatus(req, res);
      }

      if (path === "/api/internal/ops/paging/run") {
        return handleInternalPagingRun(req, res);
      }

      if (path === "/api/internal/workspace/sync") {
        return handleInternalWorkspaceSync(req, res);
      }

      if (path === "/api/internal/me") {
        return handleInternalMe(req, res);
      }

      match = path.match(/^\/api\/internal\/guilds\/([^/]+)\/channels$/);
      if (match) {
        return handleInternalGuildChannels(req, res, decodeURIComponent(match[1]));
      }

      match = path.match(/^\/api\/internal\/guilds\/([^/]+)\/members$/);
      if (match) {
        return handleInternalGuildMembers(req, res, decodeURIComponent(match[1]));
      }

      match = path.match(/^\/api\/internal\/guilds\/([^/]+)\/roles$/);
      if (match) {
        return handleInternalGuildRoles(req, res, decodeURIComponent(match[1]));
      }

      match = path.match(/^\/api\/internal\/guilds\/([^/]+)\/keyword-filters$/);
      if (match) {
        return handleInternalGuildKeywordFilters(req, res, decodeURIComponent(match[1]));
      }

      if (path === "/api/internal/guilds") {
        return handleInternalGuilds(req, res);
      }

      match = path.match(/^\/api\/internal\/workspace\/([^/]+)$/);
      if (match) {
        return handleInternalWorkspace(req, res, decodeURIComponent(match[1]));
      }

      if (path === "/api/internal/templates") {
        return handleInternalTemplates(req, res);
      }

      if (path === "/api/internal/social/oauth/start") {
        return handleInternalSocialOAuthStart(req, res);
      }

      if (path === "/api/internal/social/connections") {
        return handleInternalSocialConnections(req, res);
      }

      match = path.match(/^\/api\/internal\/social\/connections\/([^/]+)$/);
      if (match) {
        return handleInternalSocialConnectionDisconnect(req, res, decodeURIComponent(match[1]));
      }

      match = path.match(/^\/api\/internal\/social\/connections\/([^/]+)\/select-page$/);
      if (match) {
        return handleInternalMetaPageSelection(req, res, decodeURIComponent(match[1]));
      }

      if (path === "/api/internal/automation/home") {
        return handleInternalAutomationHome(req, res);
      }

      if (path === "/api/internal/automation/activity") {
        return handleInternalAutomationActivity(req, res, url);
      }

      if (path === "/api/internal/automation/scheduled") {
        return handleInternalScheduledDispatches(req, res, url);
      }

      if (path === "/api/internal/platform-events") {
        return handlePlatformEventIngest(req, res);
      }

      if (path === "/api/internal/mobile-sessions") {
        return handleInternalMobileSessionIssue(req, res);
      }

      if (path === "/api/mobile/devices") {
        return handleMobileDevices(req, res);
      }

      if (path === "/api/mobile/discord/session") {
        return handleMobileDiscordSession(req, res);
      }

      if (path === "/api/mobile/social/oauth/start") {
        return handleSocialOAuthStart(req, res);
      }

      if (path === "/api/mobile/social/oauth/callback") {
        return handleSocialOAuthCallback(req, res, url);
      }

      if (
        path === "/facebook/callback" ||
        path === "/instagram/callback" ||
        path === "/tiktok/callback" ||
        path === "/x/callback" ||
        path === "/youtube/callback" ||
        path === "/twitch/callback"
      ) {
        return handleSocialOAuthCallback(req, res, url);
      }

      match = path.match(/^\/api\/mobile\/social\/connections\/([^/]+)$/);
      if (match) {
        return handleSocialConnectionDisconnect(req, res, decodeURIComponent(match[1]));
      }

      match = path.match(/^\/api\/mobile\/social\/connections\/([^/]+)\/select-page$/);
      if (match) {
        return handleMetaPageSelection(req, res, decodeURIComponent(match[1]));
      }

      if (path === "/api/mobile/profile") {
        return handleMobileProfile(req, res);
      }

      match = path.match(/^\/api\/mobile\/guilds\/([^/]+)\/workspace$/);
      if (match) {
        return handleMobileGuildWorkspace(req, res, decodeURIComponent(match[1]));
      }

      match = path.match(/^\/api\/mobile\/guilds\/([^/]+)\/config$/);
      if (match) {
        return handleMobileGuildConfig(req, res, decodeURIComponent(match[1]));
      }

      match = path.match(/^\/api\/mobile\/guilds\/([^/]+)\/channels$/);
      if (match) {
        return handleMobileGuildChannels(req, res, decodeURIComponent(match[1]));
      }

      match = path.match(/^\/api\/mobile\/guilds\/([^/]+)\/members$/);
      if (match) {
        return handleMobileGuildMembers(req, res, decodeURIComponent(match[1]));
      }

      match = path.match(/^\/api\/mobile\/guilds\/([^/]+)\/roles$/);
      if (match) {
        return handleMobileGuildRoles(req, res, decodeURIComponent(match[1]));
      }

      match = path.match(/^\/api\/mobile\/guilds\/([^/]+)\/creators\/([^/]+)$/);
      if (match) {
        return handleMobileGuildCreatorDetail(req, res, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
      }

      match = path.match(/^\/api\/mobile\/guilds\/([^/]+)\/keyword-filters$/);
      if (match) {
        return handleMobileGuildKeywordFilters(req, res, decodeURIComponent(match[1]));
      }

      if (path === "/api/mobile/automation/home") {
        return handleAutomationHome(req, res);
      }

      if (path === "/api/mobile/automation/activity") {
        return handleAutomationActivity(req, res, url);
      }

      if (path === "/api/internal/social-events/evaluate") {
        return handleSocialEventEvaluation(req, res);
      }

      if (path === "/api/internal/social-events") {
        return handleSocialEventIngest(req, res);
      }

      if (path === "/api/internal/social-adapters/instagram/media") {
        return handleInstagramMediaAdapter(req, res);
      }

      match = path.match(/^\/api\/guilds\/([^/]+)\/config$/);
      if (match) {
        return handleGuildConfig(req, res, decodeURIComponent(match[1]));
      }

      match = path.match(/^\/api\/guilds\/([^/]+)\/creators$/);
      if (match) {
        return handleCreators(req, res, decodeURIComponent(match[1]));
      }

      match = path.match(/^\/api\/lite\/guilds\/([^/]+)\/capacity$/);
      if (match) {
        return handleLiteCapacity(req, res, decodeURIComponent(match[1]));
      }

      match = path.match(/^\/api\/lite\/guilds\/([^/]+)\/creators$/);
      if (match) {
        return await handleLiteCreators(req, res, decodeURIComponent(match[1]));
      }

      match = path.match(/^\/api\/lite\/guilds\/([^/]+)\/creators\/([^/]+)$/);
      if (match) {
        return await handleLiteCreatorDelete(req, res, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
      }

      match = path.match(/^\/api\/lite\/guilds\/([^/]+)\/channel$/);
      if (match) {
        return await handleLiteChannel(req, res, decodeURIComponent(match[1]));
      }

      match = path.match(/^\/api\/mobile\/guilds\/([^/]+)\/creators\/([^/]+)\/profile$/);
      if (match) {
        return await handleMobileCreatorProfile(req, res, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
      }

      match = path.match(/^\/api\/guilds\/([^/]+)\/creators\/([^/]+)\/profile$/);
      if (match) {
        return await handleCreatorProfile(req, res, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
      }

      match = path.match(/^\/api\/guilds\/([^/]+)\/creators\/([^/]+)\/access$/);
      if (match) {
        return await handleCreatorAccess(req, res, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
      }

      match = path.match(/^\/api\/mobile\/creators\/([^/]+)\/post-builder$/);
      if (match) {
        return handleCreatorPostBuilder(req, res, decodeURIComponent(match[1]));
      }

      match = path.match(/^\/api\/mobile\/creators\/([^/]+)\/post-builder\/templates$/);
      if (match) {
        return handleCreatorPostTemplate(req, res, decodeURIComponent(match[1]));
      }

      match = path.match(/^\/api\/mobile\/creators\/([^/]+)\/post-builder\/connections\/([^/]+)$/);
      if (match) {
        return handleCreatorSocialConnection(req, res, decodeURIComponent(match[1]), decodeURIComponent(match[2]).toLowerCase());
      }

      match = path.match(/^\/api\/mobile\/creators\/([^/]+)\/post-builder\/publish$/);
      if (match) {
        return handleCreatorPostPublish(req, res, decodeURIComponent(match[1]));
      }

      match = path.match(/^\/api\/mobile\/creators\/([^/]+)\/post-builder\/scheduled$/);
      if (match) {
        return handleCreatorScheduledDispatches(req, res, decodeURIComponent(match[1]), url);
      }

      match = path.match(/^\/api\/mobile\/dispatches\/([^/]+)\/repost$/);
      if (match) {
        return handleDispatchRepost(req, res, decodeURIComponent(match[1]));
      }

      return sendNotFound(res);
    } catch (error) {
      return sendJson(res, 500, {
        error: error?.message || "Internal server error",
      });
    }
  });
}

module.exports = {
  createServer,
};
