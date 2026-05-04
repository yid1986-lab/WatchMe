const { getLiteCapacity, getLiteCreators } = require("./api-client");
const { buildLiteCommandModel } = require("./commands");
const { getLiteConfig } = require("./config");
const { buildLiteSubmissionFlow } = require("./submission");
const { validateLiteLaunchReadiness } = require("./validation");

async function runLiteSmoke({
  guildId = process.env.LITE_SMOKE_GUILD_ID || "smoke-guild",
  useBackend = process.env.LITE_SMOKE_USE_BACKEND === "1",
} = {}) {
  const issues = validateLiteLaunchReadiness();
  if (issues.length) {
    const error = new Error("Lite V2 launch validation failed");
    error.issues = issues;
    throw error;
  }

  const config = getLiteConfig();
  const flow = buildLiteSubmissionFlow();
  const model = buildLiteCommandModel({
    guildId,
    creators: [],
    upgradeUrl: config.upgradeUrl,
  });

  const summary = {
    mode: "offline",
    commandName: model.command.name,
    creatorLimit: flow.creatorLimit,
    supportedPlatforms: flow.supportedPlatforms,
    panelTitle: model.panel.title,
    backend: null,
  };

  if (useBackend) {
    const [capacity, creators] = await Promise.all([getLiteCapacity(guildId), getLiteCreators(guildId)]);
    summary.backend = {
      capacity,
      creators,
    };
  }

  return summary;
}

module.exports = {
  runLiteSmoke,
};
