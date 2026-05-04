const { PLAN_LIMITS } = require("../../../packages/shared/src");
const { query } = require("./db");
const { ensureGuild } = require("./queries");
const { cleanText } = require("./utils");

const LITE_UPGRADE_URL = process.env.LITE_PRO_UPGRADE_URL || "https://pro.watchme-bot.com/login";

async function getGuildCreatorCount(guildId) {
  const result = await query(
    `
      SELECT COUNT(*)::int AS count
      FROM lite_creators
      WHERE guild_id = $1
    `,
    [guildId]
  );

  return Number(result.rows[0]?.count || 0);
}

async function getLiteCapacityStatus(guildId) {
  const limit = PLAN_LIMITS.lite.maxCreatorsPerGuild;
  const count = await getGuildCreatorCount(guildId);

  return {
    guildId,
    plan: "lite",
    creatorCount: count,
    creatorLimit: limit,
    remaining: Math.max(0, limit - count),
    isFull: count >= limit,
    upgradeUrl: LITE_UPGRADE_URL,
  };
}

function normalizeLiteCreatorInput(body = {}) {
  return {
    platform: cleanText(body.platform)?.toLowerCase() || null,
    display_name: cleanText(body.display_name),
    url: cleanText(body.url),
    external_id: cleanText(body.external_id),
    added_by_discord_user_id: cleanText(body.added_by_discord_user_id),
  };
}

function validateLiteCreatorInput(input = {}) {
  const supported = new Set(PLAN_LIMITS.lite.supportedPlatforms);

  if (!input.platform || !input.url) {
    return {
      ok: false,
      error: "Add a Twitch or YouTube creator link.",
    };
  }

  if (!supported.has(input.platform)) {
    return {
      ok: false,
      error: `Lite only supports ${PLAN_LIMITS.lite.supportedPlatforms.join(", ")}.`,
    };
  }

  return {
    ok: true,
  };
}

async function getLiteCreators(guildId) {
  const result = await query(
    `
      SELECT
        lite_creator_id,
        guild_id,
        platform,
        display_name,
        url,
        external_id,
        added_by_discord_user_id
      FROM lite_creators
      WHERE guild_id = $1
      ORDER BY created_at ASC, lite_creator_id ASC
    `,
    [guildId]
  );

  return result.rows;
}

async function addLiteCreator(guildId, creator) {
  await ensureGuild(guildId);

  const result = await query(
    `
      INSERT INTO lite_creators (
        guild_id,
        platform,
        display_name,
        url,
        external_id,
        added_by_discord_user_id,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *
    `,
    [
      guildId,
      creator.platform,
      creator.display_name,
      creator.url,
      creator.external_id,
      creator.added_by_discord_user_id,
    ]
  );

  return result.rows[0];
}

async function removeLiteCreator(guildId, liteCreatorId) {
  const result = await query(
    `
      DELETE FROM lite_creators
      WHERE guild_id = $1 AND lite_creator_id = $2
      RETURNING *
    `,
    [guildId, liteCreatorId]
  );

  return result.rows[0] || null;
}

function buildLiteUpgradePrompt(status) {
  return {
    title: "Lite creator limit reached",
    message: `You've reached ${status.creatorLimit} creators on Lite. Upgrade to Pro to add more creators.`,
    upgradeUrl: status.upgradeUrl,
    ctaLabel: "Upgrade to Pro",
  };
}

module.exports = {
  addLiteCreator,
  buildLiteUpgradePrompt,
  getGuildCreatorCount,
  getLiteCapacityStatus,
  getLiteCreators,
  normalizeLiteCreatorInput,
  removeLiteCreator,
  validateLiteCreatorInput,
};
