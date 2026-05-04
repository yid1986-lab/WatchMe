const { Client, GatewayIntentBits } = require("discord.js");
const { buildLiteSubmissionFlow } = require("./submission");
const { buildLiteCommandModel } = require("./commands");
const { getLiteConfig } = require("./config");
const { runLiteCutoverPreflight } = require("./cutover-preflight");
const { registerLiteInteractions } = require("./discord-runtime");
const { runLiteSmoke } = require("./smoke");
const { validateLiteLaunchReadiness } = require("./validation");

const args = new Set(process.argv.slice(2));
const mode = args.has("--check")
  ? "check"
  : args.has("--smoke")
    ? "smoke"
    : args.has("--preflight")
      ? "preflight"
      : "run";

async function runCheckMode() {
  const issues = validateLiteLaunchReadiness();

  if (issues.length) {
    console.error("[lite.v2] validation failed");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    return 1;
  }

  console.log("[lite.v2] validation passed");
  return 0;
}

async function runSmokeMode() {
  try {
    const result = await runLiteSmoke();
    console.log("[lite.v2] smoke passed");
    console.log(`[lite.v2] command: /${result.commandName}`);
    console.log(`[lite.v2] supports ${result.supportedPlatforms.join(", ")} with a ${result.creatorLimit}-creator Lite cap`);

    if (result.backend) {
      console.log(
        `[lite.v2] backend smoke loaded ${result.backend.creators?.creators?.length || 0} creators and validated the local Lite API`
      );
    } else if (process.env.LITE_SMOKE_USE_BACKEND === "1") {
      console.log("[lite.v2] backend smoke was requested");
    } else {
      console.log("[lite.v2] backend smoke skipped");
    }

    return 0;
  } catch (error) {
    console.error("[lite.v2] smoke failed");
    if (Array.isArray(error?.issues)) {
      for (const issue of error.issues) {
        console.error(`- ${issue}`);
      }
    } else {
      console.error(error?.message || error);
    }
    return 1;
  }
}

async function runPreflightMode() {
  try {
    const result = await runLiteCutoverPreflight();
    console.log("[lite.v2] cutover preflight passed");
    console.log(`[lite.v2] api: ${result.apiBaseUrl}`);
    console.log(`[lite.v2] guild: ${result.guildId}`);
    console.log(`[lite.v2] health: ${result.health.service || "ok"}`);
    console.log(
      `[lite.v2] state: ${result.creatorCount} creators, announce channel ${
        result.guildConfig?.announce_channel_id || "not set"
      }`
    );
    if (result.writeCycle) {
      console.log(
        `[lite.v2] write cycle: add=${result.writeCycle.creatorCountAfterAdd} cleanup=${result.writeCycle.creatorCountAfterCleanup}`
      );
    }
    return 0;
  } catch (error) {
    console.error("[lite.v2] cutover preflight failed");
    if (Array.isArray(error?.issues)) {
      for (const issue of error.issues) {
        console.error(`- ${issue}`);
      }
    } else {
      console.error(error?.message || error);
    }
    return 1;
  }
}

async function runDiscordMode() {
  const config = getLiteConfig();
  const flow = buildLiteSubmissionFlow();
  const model = buildLiteCommandModel({
    guildId: "example-guild",
    creators: [],
  });

  console.log("[lite.v2] Discord app bootstrap ready");
  console.log(`[lite.v2] supports ${flow.supportedPlatforms.join(", ")} with a ${flow.creatorLimit}-creator Lite cap`);
  console.log(`[lite.v2] command: /${model.command.name}`);

  if (!config.discordToken) {
    console.log("[lite.v2] no Discord token configured yet");
    return 0;
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once("ready", async () => {
    try {
      console.log(`[lite.v2] logged in as ${client.user?.tag || "unknown"}`);
      await registerLiteInteractions(client, {
        commandGuildId: config.commandGuildId,
      });
      console.log(
        config.commandGuildId
          ? `[lite.v2] interactions registered for guild ${config.commandGuildId}`
          : "[lite.v2] interactions registered globally"
      );
    } catch (error) {
      console.error("[lite.v2] interaction registration failed", error?.message || error);
      process.exitCode = 1;
      client.destroy();
    }
  });

  try {
    await client.login(config.discordToken);
    return 0;
  } catch (error) {
    console.error("[lite.v2] login failed", error?.message || error);
    return 1;
  }
}

async function main() {
  if (mode === "check") {
    return runCheckMode();
  }

  if (mode === "smoke") {
    return runSmokeMode();
  }

  if (mode === "preflight") {
    return runPreflightMode();
  }

  return runDiscordMode();
}

main()
  .then((exitCode) => {
    if (typeof exitCode === "number") {
      process.exitCode = exitCode;
    }
  })
  .catch((error) => {
    console.error("[lite.v2] startup failed", error?.message || error);
    process.exitCode = 1;
  });
