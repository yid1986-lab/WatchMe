const {
  addLiteCreator,
  getGuildConfig,
  getLiteCapacity,
  getLiteCreators,
  removeLiteCreator,
  setLiteAlertChannel,
} = require("./api-client");
const { getLiteConfig } = require("./config");
const { validateLiteLaunchReadiness } = require("./validation");

function buildPreflightError(issues) {
  const error = new Error("Lite V2 cutover preflight failed");
  error.issues = issues.slice();
  return error;
}

async function fetchApiHealth(baseUrl) {
  let response;
  try {
    response = await fetch(`${baseUrl}/api/health`);
  } catch (error) {
    throw new Error(`Could not reach Lite API health endpoint: ${error?.message || error}`);
  }

  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  if (!response.ok) {
    throw new Error(`Lite API health returned ${response.status}`);
  }

  if (body?.ok !== true) {
    throw new Error("Lite API health did not report ok: true");
  }

  return body;
}

async function runWriteCycle(guildId) {
  const originalGuildConfig = await getGuildConfig(guildId).catch(() => ({ config: null }));
  const originalConfig = originalGuildConfig?.config || originalGuildConfig || {};
  const originalAnnounceChannelId = originalConfig.announce_channel_id || "";
  const originalLiveChannelId = originalConfig.live_channel_id || originalAnnounceChannelId || "";
  const announceChannelId = `preflight-channel-${guildId}`;
  let createdLiteCreatorId = null;

  try {
    const savedChannel = await setLiteAlertChannel(guildId, announceChannelId);
    const addResult = await addLiteCreator(guildId, {
      platform: "youtube",
      display_name: "WatchMe Preflight",
      url: "https://www.youtube.com/channel/UC_PREFLIGHT_WATCHME_LITE",
      external_id: "UC_PREFLIGHT_WATCHME_LITE",
      added_by_discord_user_id: "preflight-user",
    });

    createdLiteCreatorId = addResult?.creator?.lite_creator_id || null;
    if (!createdLiteCreatorId) {
      throw new Error("write cycle did not return a Lite creator id");
    }

    const creatorsAfterAdd = await getLiteCreators(guildId);
    const capacityAfterAdd = await getLiteCapacity(guildId);

    await removeLiteCreator(guildId, createdLiteCreatorId);
    createdLiteCreatorId = null;

    const creatorsAfterCleanup = await getLiteCreators(guildId);
    const capacityAfterCleanup = await getLiteCapacity(guildId);

    return {
      savedChannelId: savedChannel?.config?.announce_channel_id || announceChannelId,
      creatorCountAfterAdd: creatorsAfterAdd.creators.length,
      creatorCountAfterCleanup: creatorsAfterCleanup.creators.length,
      capacityAfterAdd: capacityAfterAdd.creatorCount,
      capacityAfterCleanup: capacityAfterCleanup.creatorCount,
    };
  } finally {
    if (createdLiteCreatorId) {
      await removeLiteCreator(guildId, createdLiteCreatorId).catch(() => {});
    }
    await setLiteAlertChannel(guildId, originalAnnounceChannelId, originalLiveChannelId).catch(() => {});
  }
}

async function runLiteCutoverPreflight({
  guildId = process.env.LITE_PREFLIGHT_GUILD_ID || "cutover-check-guild",
  allowWrites = process.env.LITE_PREFLIGHT_ALLOW_WRITES === "1",
} = {}) {
  const config = getLiteConfig();
  const issues = validateLiteLaunchReadiness();

  if (!config.discordToken) {
    issues.push(
      "Missing Lite Discord token. Set LITE_DISCORD_TOKEN."
    );
  }

  if (!config.liteApiWriteToken) {
    issues.push(
      "Missing Lite API write token. Set LITE_API_WRITE_TOKEN."
    );
  }

  if (issues.length) {
    throw buildPreflightError(issues);
  }

  const health = await fetchApiHealth(config.liteApiBaseUrl);
  const [guildConfig, capacity, creators] = await Promise.all([
    getGuildConfig(guildId),
    getLiteCapacity(guildId),
    getLiteCreators(guildId),
  ]);

  const summary = {
    ok: true,
    mode: "cutover-preflight",
    apiBaseUrl: config.liteApiBaseUrl,
    guildId,
    health,
    guildConfig,
    capacity,
    creatorCount: Array.isArray(creators?.creators) ? creators.creators.length : 0,
    writeCycle: null,
  };

  if (allowWrites) {
    try {
      summary.writeCycle = await runWriteCycle(guildId);
    } catch (error) {
      issues.push(`Lite protected write cycle failed: ${error?.message || error}`);
    }
  }

  if (issues.length) {
    throw buildPreflightError(issues);
  }

  return summary;
}

module.exports = {
  runLiteCutoverPreflight,
};
