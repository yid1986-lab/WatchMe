const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");

const proDbModulePath = path.resolve(__dirname, "../../pro.v2/apps/api/src/db.js");
const proJobsModulePath = path.resolve(__dirname, "../../pro.v2/apps/api/src/jobs.js");
const proServerModulePath = path.resolve(__dirname, "../../pro.v2/apps/api/src/server.js");
const liteConfigModulePath = require.resolve("../src/config");
const liteApiClientModulePath = require.resolve("../src/api-client");
const liteSmokeModulePath = require.resolve("../src/smoke");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createResponseState() {
  return {
    guilds: new Set(),
    guildConfigs: new Map(),
    liteCreators: [],
    platformSubscriptions: [],
    renewalCalls: [],
    nextLiteCreatorId: 1,
    nextSubscriptionId: 1,
  };
}

function makeDbMock(state) {
  function isSchemaBootstrapQuery(text) {
    return (
      text.includes("ALTER TABLE guild_config") ||
      text.includes("CREATE TABLE IF NOT EXISTS creator_live_alerts") ||
      text.includes("CREATE INDEX IF NOT EXISTS creator_live_alerts_") ||
      text.includes("ALTER TABLE creator_post_dispatches") ||
      text.includes("CREATE UNIQUE INDEX IF NOT EXISTS creator_post_dispatches_source_idx") ||
      text.includes("CREATE TABLE IF NOT EXISTS social_origin_decisions") ||
      text.includes("CREATE INDEX IF NOT EXISTS social_origin_decisions_") ||
      text.includes("CREATE TABLE IF NOT EXISTS automation_activity_events") ||
      text.includes("CREATE INDEX IF NOT EXISTS automation_activity_user_created_idx") ||
      text.includes("CREATE UNIQUE INDEX IF NOT EXISTS automation_activity_source_idx") ||
      text.includes("CREATE TABLE IF NOT EXISTS mobile_push_devices") ||
      text.includes("CREATE INDEX IF NOT EXISTS mobile_push_devices_user_status_idx") ||
      text.includes("CREATE TABLE IF NOT EXISTS mobile_push_deliveries") ||
      text.includes("CREATE INDEX IF NOT EXISTS mobile_push_deliveries_activity_idx")
    );
  }

  function getLiteSubscriptions(guildId) {
    return state.platformSubscriptions
      .filter(
        (row) =>
          row.guild_id === guildId &&
          row.creator_guild_id === null &&
          row.creator_discord_user_id === null &&
          String(row.metadata_json?.scope || "") === "lite" &&
          row.status === "active"
      )
      .sort((a, b) => `${a.platform}:${a.topic_key}`.localeCompare(`${b.platform}:${b.topic_key}`));
  }

  return {
    getPool: () => null,
    query: async (text, params = []) => {
      if (isSchemaBootstrapQuery(text)) {
        return { rows: [] };
      }

      if (text.includes("INSERT INTO guilds")) {
        state.guilds.add(params[0]);
        return { rows: [{ guild_id: params[0] }] };
      }

      if (text.includes("FROM guild_config")) {
        const row = state.guildConfigs.get(params[0]) || null;
        return { rows: row ? [clone(row)] : [] };
      }

      if (text.includes("INSERT INTO guild_config")) {
        const row = {
          guild_id: params[0],
          announce_channel_id: params[1],
          live_channel_id: params[2],
          socials_feed_channel_id: params[3],
          live_role_id: params[4],
          auto_cleanup: params[5],
          cooldown_seconds: params[6],
          mention_mode: params[7],
          brand_name: params[8],
          brand_logo_url: params[9],
          preview_image_url: params[10],
          footer_text: params[11],
          guild_twitch_url: params[12],
          guild_youtube_url: params[13],
          guild_kick_url: params[14],
          updated_at: "2026-04-08T00:00:00.000Z",
        };
        state.guildConfigs.set(params[0], row);
        return { rows: [clone(row)] };
      }

      if (text.includes("SELECT COUNT(*)::int AS count") && text.includes("FROM lite_creators")) {
        return {
          rows: [
            {
              count: state.liteCreators.filter((row) => row.guild_id === params[0]).length,
            },
          ],
        };
      }

      if (text.includes("FROM lite_creators") && text.includes("ORDER BY created_at ASC, lite_creator_id ASC")) {
        return {
          rows: state.liteCreators
            .filter((row) => row.guild_id === params[0])
            .slice()
            .sort((a, b) => a.lite_creator_id - b.lite_creator_id)
            .map(clone),
        };
      }

      if (text.includes("INSERT INTO lite_creators")) {
        const row = {
          lite_creator_id: state.nextLiteCreatorId,
          guild_id: params[0],
          platform: params[1],
          display_name: params[2],
          url: params[3],
          external_id: params[4],
          added_by_discord_user_id: params[5],
          created_at: "2026-04-08T00:00:00.000Z",
          updated_at: "2026-04-08T00:00:00.000Z",
        };
        state.nextLiteCreatorId += 1;
        state.liteCreators.push(row);
        return { rows: [clone(row)] };
      }

      if (text.includes("DELETE FROM lite_creators")) {
        const index = state.liteCreators.findIndex(
          (row) => row.guild_id === params[0] && row.lite_creator_id === params[1]
        );
        if (index === -1) {
          return { rows: [] };
        }

        const [removed] = state.liteCreators.splice(index, 1);
        return { rows: [clone(removed)] };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
    withTransaction: async (runWithClient) =>
      runWithClient({
        query: async (text, params = []) => {
          if (isSchemaBootstrapQuery(text)) {
            return { rows: [] };
          }

          if (text.includes("FROM lite_creators")) {
            return {
              rows: state.liteCreators
                .filter((row) => row.guild_id === params[0])
                .slice()
                .sort((a, b) => a.lite_creator_id - b.lite_creator_id)
                .map(clone),
            };
          }

          if (text.includes("AND topic_key <> ALL")) {
            const [platform, guildId, keepTopicKeys] = params;
            for (const row of state.platformSubscriptions) {
              if (
                row.platform === platform &&
                row.guild_id === guildId &&
                row.creator_guild_id === null &&
                row.creator_discord_user_id === null &&
                String(row.metadata_json?.scope || "") === "lite" &&
                !keepTopicKeys.includes(row.topic_key)
              ) {
                row.status = "disabled";
                row.updated_at = "2026-04-08T00:00:00.000Z";
              }
            }
            return { rows: [] };
          }

          if (text.includes("AND COALESCE(metadata_json->>'scope', '') = 'lite'") && text.includes("SET")) {
            const [platform, guildId] = params;
            for (const row of state.platformSubscriptions) {
              if (
                row.platform === platform &&
                row.guild_id === guildId &&
                row.creator_guild_id === null &&
                row.creator_discord_user_id === null &&
                String(row.metadata_json?.scope || "") === "lite"
              ) {
                row.status = "disabled";
                row.updated_at = "2026-04-08T00:00:00.000Z";
              }
            }
            return { rows: [] };
          }

          if (text.includes("INSERT INTO platform_subscriptions")) {
            const [guildId, platform, topicKey, metadataJson] = params;
            const existing = state.platformSubscriptions.find(
              (row) =>
                row.guild_id === guildId &&
                row.creator_guild_id === null &&
                row.creator_discord_user_id === null &&
                row.platform === platform &&
                row.topic_key === topicKey
            );
            const nextMetadata = existing
              ? { ...existing.metadata_json, ...JSON.parse(metadataJson) }
              : JSON.parse(metadataJson);
            const row = existing || {
              subscription_id: state.nextSubscriptionId,
              guild_id: guildId,
              creator_guild_id: null,
              creator_discord_user_id: null,
              platform,
              topic_key: topicKey,
              callback_url: null,
              status: "active",
              metadata_json: {},
              updated_at: "2026-04-08T00:00:00.000Z",
            };
            if (!existing) {
              state.nextSubscriptionId += 1;
            }
            row.status = "active";
            row.metadata_json = nextMetadata;
            row.updated_at = "2026-04-08T00:00:00.000Z";
            if (!existing) {
              state.platformSubscriptions.push(row);
            }
            return { rows: [clone(row)] };
          }

          if (
            text.includes("FROM platform_subscriptions") &&
            text.includes("status = 'active'") &&
            text.includes("ORDER BY platform, topic_key, subscription_id")
          ) {
            const rows = getLiteSubscriptions(params[0]);
            return { rows: rows.map(clone) };
          }

          throw new Error(`Unexpected transaction query: ${text}`);
        },
      }),
    closePool: async () => undefined,
  };
}

function mockModule(modulePath, exports) {
  const original = require.cache[modulePath];
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };

  return () => {
    if (original) {
      require.cache[modulePath] = original;
    } else {
      delete require.cache[modulePath];
    }
  };
}

test("Lite V2 protected backend smoke works with V1-style fallback tokens in compatibility mode", async () => {
  const previousEnv = {
    NODE_ENV: process.env.NODE_ENV,
    SESSION_SECRET: process.env.SESSION_SECRET,
    PUBLIC_API_WRITE_TOKEN: process.env.PUBLIC_API_WRITE_TOKEN,
    INTERNAL_API_TOKEN: process.env.INTERNAL_API_TOKEN,
    LITE_API_WRITE_TOKEN: process.env.LITE_API_WRITE_TOKEN,
    LITE_API_BASE_URL: process.env.LITE_API_BASE_URL,
  };

  const state = createResponseState();
  const restoreDb = mockModule(proDbModulePath, makeDbMock(state));
  const restoreJobs = mockModule(proJobsModulePath, {
    enqueuePlatformEventIngest: async () => ({ queued: true }),
    enqueuePlatformSubscriptionRenewal: async (...args) => {
      state.renewalCalls.push(args);
      return { queued: true };
    },
    enqueueSocialPostDispatch: async () => ({ queued: true }),
  });

  delete require.cache[proServerModulePath];
  delete require.cache[liteConfigModulePath];
  delete require.cache[liteApiClientModulePath];
  delete require.cache[liteSmokeModulePath];

  process.env.NODE_ENV = "development";
  process.env.SESSION_SECRET = "watchme-v1-session-secret";
  delete process.env.PUBLIC_API_WRITE_TOKEN;
  delete process.env.INTERNAL_API_TOKEN;
  delete process.env.LITE_API_WRITE_TOKEN;

  const { createServer } = require("../../pro.v2/apps/api/src/server");
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    process.env.LITE_API_BASE_URL = `http://127.0.0.1:${server.address().port}`;

    delete require.cache[liteConfigModulePath];
    delete require.cache[liteApiClientModulePath];
    delete require.cache[liteSmokeModulePath];

    const {
      getLiteCapacity,
      getLiteCreators,
      setLiteAlertChannel,
      addLiteCreator,
      removeLiteCreator,
      getGuildConfig,
    } = require("../src/api-client");
    const { runLiteSmoke } = require("../src/smoke");

    const initialSmoke = await runLiteSmoke({
      guildId: "guild-protected-smoke",
      useBackend: true,
    });
    assert.equal(initialSmoke.backend.capacity.creatorCount, 0);
    assert.equal(initialSmoke.backend.creators.creators.length, 0);

    const savedChannel = await setLiteAlertChannel("guild-protected-smoke", "channel-123");
    assert.equal(savedChannel.ok, true);
    assert.equal(savedChannel.config.announce_channel_id, "channel-123");

    const addedCreator = await addLiteCreator("guild-protected-smoke", {
      platform: "youtube",
      display_name: "WatchMe Live",
      url: "https://youtube.com/@WatchMeLive",
      external_id: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
      added_by_discord_user_id: "user-1",
    });
    assert.equal(addedCreator.ok, true);
    assert.equal(addedCreator.creator.platform, "youtube");
    assert.equal(addedCreator.capacity.creatorCount, 1);

    const guildConfig = await getGuildConfig("guild-protected-smoke");
    assert.equal(guildConfig.config.announce_channel_id, "channel-123");

    const creators = await getLiteCreators("guild-protected-smoke");
    assert.equal(creators.creators.length, 1);

    const capacity = await getLiteCapacity("guild-protected-smoke");
    assert.equal(capacity.creatorCount, 1);
    assert.equal(capacity.remaining, 4);

    const removed = await removeLiteCreator(
      "guild-protected-smoke",
      addedCreator.creator.lite_creator_id
    );
    assert.equal(removed.ok, true);
    assert.equal(removed.capacity.creatorCount, 0);

    const finalSmoke = await runLiteSmoke({
      guildId: "guild-protected-smoke",
      useBackend: true,
    });
    assert.equal(finalSmoke.backend.capacity.creatorCount, 0);
    assert.equal(finalSmoke.backend.creators.creators.length, 0);
    assert.ok(state.renewalCalls.length >= 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreJobs();
    restoreDb();
    delete require.cache[proServerModulePath];
    delete require.cache[liteConfigModulePath];
    delete require.cache[liteApiClientModulePath];
    delete require.cache[liteSmokeModulePath];

    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
