const { buildLiteSubmissionResult } = require("./submission");
const { buildLitePanelState } = require("./panel");

function getLiteCommandDefinition() {
  return {
    name: "wme",
    description: "Open the WatchMe Lite control panel",
    defaultMemberPermissions: ["ManageGuild"],
  };
}

function buildAddCreatorResult({ isFull, upgradeUrl = "https://pro.watchme-bot.com/login" }) {
  if (isFull) {
    return buildLiteSubmissionResult({
      code: "LITE_CREATOR_LIMIT_REACHED",
      capacity: {
        creatorLimit: 5,
        upgradeUrl,
      },
    });
  }

  return buildLiteSubmissionResult({ ok: true });
}

function buildLiteCommandModel({
  guildId,
  alertChannelId = null,
  creators = [],
  upgradeUrl = "https://pro.watchme-bot.com/login",
}) {
  return {
    command: getLiteCommandDefinition(),
    panel: buildLitePanelState({
      guildId,
      alertChannelId,
      creators,
      upgradeUrl,
    }),
  };
}

module.exports = {
  buildAddCreatorResult,
  buildLiteCommandModel,
  getLiteCommandDefinition,
};
