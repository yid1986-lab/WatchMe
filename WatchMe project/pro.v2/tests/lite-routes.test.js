const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");

const serverModulePath = path.resolve(__dirname, "../apps/api/src/server.js");
const queriesModulePath = path.resolve(__dirname, "../apps/api/src/queries.js");
const dbModulePath = path.resolve(__dirname, "../apps/api/src/db.js");
const jobsModulePath = path.resolve(__dirname, "../apps/api/src/jobs.js");
const { createMobileSessionToken } = require("../apps/api/src/mobile-auth");
let queue = Promise.resolve();

function run(name, fn) {
  queue = queue.then(async () => {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}`);
      console.error(error?.stack || error);
      process.exitCode = 1;
    }
  });
}

function createResponseState() {
  return {
    guilds: new Set(),
    users: new Map(),
    guildConfigs: new Map(),
    creatorIdentities: new Map(),
    creatorSocialConnections: [],
    creatorPostTemplates: [],
    creatorPostDispatches: [],
    automationActivities: [],
    liteCreators: [],
    platformSubscriptions: [],
    renewalCalls: [],
    nextLiteCreatorId: 1,
    nextSubscriptionId: 1,
    nextConnectionId: 1,
    nextTemplateId: 1,
    nextDispatchId: 1,
    nextActivityId: 1,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function resetApiModuleCaches() {
  delete require.cache[serverModulePath];
  delete require.cache[queriesModulePath];
}

function makeDbMock(state) {
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

  function disablePlatformSubscriptions({
    platform,
    guildId = null,
    creatorGuildId = null,
    creatorDiscordUserId = null,
  }) {
    for (const row of state.platformSubscriptions) {
      if (
        row.platform === platform &&
        row.guild_id === guildId &&
        row.creator_guild_id === creatorGuildId &&
        row.creator_discord_user_id === creatorDiscordUserId
      ) {
        row.status = "disabled";
        row.updated_at = "2026-04-08T00:00:00.000Z";
      }
    }
  }

  function upsertPlatformSubscription({
    guildId = null,
    creatorGuildId = null,
    creatorDiscordUserId = null,
    platform,
    topicKey,
    callbackUrl = null,
    metadataJson = {},
  }) {
    const existing = state.platformSubscriptions.find(
      (row) =>
        row.guild_id === guildId &&
        row.creator_guild_id === creatorGuildId &&
        row.creator_discord_user_id === creatorDiscordUserId &&
        row.platform === platform &&
        row.topic_key === topicKey
    );
    const nextMetadata =
      typeof metadataJson === "string" ? JSON.parse(metadataJson) : clone(metadataJson || {});
    const row = existing || {
      subscription_id: state.nextSubscriptionId,
      guild_id: guildId,
      creator_guild_id: creatorGuildId,
      creator_discord_user_id: creatorDiscordUserId,
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
    row.callback_url = callbackUrl || row.callback_url || null;
    row.status = "active";
    row.metadata_json = { ...(row.metadata_json || {}), ...nextMetadata };
    row.updated_at = "2026-04-08T00:00:00.000Z";
    if (!existing) {
      state.platformSubscriptions.push(row);
    }
    return clone(row);
  }

  function upsertCreatorSocialConnection({
    discordUserId,
    platform,
    externalAccountId = null,
    externalAccountName = null,
    tokenExpiresAt = null,
    status = "active",
    metadataJson = {},
  }) {
    const existing = state.creatorSocialConnections.find(
      (row) => row.discord_user_id === discordUserId && row.platform === platform
    );
    const nextMetadata =
      typeof metadataJson === "string" ? JSON.parse(metadataJson) : clone(metadataJson || {});
    const row = existing || {
      connection_id: state.nextConnectionId,
      discord_user_id: discordUserId,
      platform,
      external_account_id: null,
      external_account_name: null,
      token_expires_at: null,
      status: "active",
      metadata_json: {},
      created_at: "2026-04-08T00:00:00.000Z",
      updated_at: "2026-04-08T00:00:00.000Z",
    };
    if (!existing) {
      state.nextConnectionId += 1;
    }
    row.external_account_id = externalAccountId;
    row.external_account_name = externalAccountName;
    row.token_expires_at = tokenExpiresAt;
    row.status = status;
    row.metadata_json = nextMetadata;
    row.updated_at = "2026-04-08T00:00:00.000Z";
    if (!existing) {
      state.creatorSocialConnections.push(row);
    }
    return clone(row);
  }

  function insertCreatorPostTemplate({
    discordUserId,
    name,
    postText,
    linkUrl,
    mediaUrlsJson,
    targetPlatformsJson,
    isDefault,
  }) {
    const row = {
      template_id: state.nextTemplateId,
      discord_user_id: discordUserId,
      name,
      post_text: postText,
      link_url: linkUrl,
      media_urls_json: Array.isArray(mediaUrlsJson) ? [...mediaUrlsJson] : [],
      target_platforms_json: Array.isArray(targetPlatformsJson) ? [...targetPlatformsJson] : [],
      is_default: Boolean(isDefault),
      created_at: "2026-04-08T00:00:00.000Z",
      updated_at: "2026-04-08T00:00:00.000Z",
    };
    state.nextTemplateId += 1;
    state.creatorPostTemplates.push(row);
    return clone(row);
  }

  return {
    getPool: () => null,
    query: async (text, params = []) => {
      if (text.includes("INSERT INTO guilds")) {
        state.guilds.add(params[0]);
        return { rows: [{ guild_id: params[0] }] };
      }

      if (text.includes("INSERT INTO users")) {
        const existing = state.users.get(params[0]) || {
          discord_user_id: params[0],
          username: null,
          avatar_url: null,
          updated_at: "2026-04-08T00:00:00.000Z",
        };
        existing.username = params[1] || existing.username;
        existing.avatar_url = params[2] || existing.avatar_url;
        existing.updated_at = "2026-04-08T00:00:00.000Z";
        state.users.set(params[0], existing);
        return { rows: [clone(existing)] };
      }

      if (text.includes("FROM guild_config")) {
        const row = state.guildConfigs.get(params[0]) || null;
        return { rows: row ? [clone(row)] : [] };
      }

      if (text.includes("FROM creator_identities")) {
        const row = state.creatorIdentities.get(params[0]) || null;
        return { rows: row ? [clone(row)] : [] };
      }

      if (text.includes("FROM creator_social_connections")) {
        return {
          rows: state.creatorSocialConnections
            .filter((row) => row.discord_user_id === params[0])
            .slice()
            .sort((a, b) => String(a.platform).localeCompare(String(b.platform)))
            .map(clone),
        };
      }

      if (text.includes("INSERT INTO creator_social_connections")) {
        const row = upsertCreatorSocialConnection({
          discordUserId: params[0],
          platform: params[1],
          externalAccountId: params[2],
          externalAccountName: params[3],
          tokenExpiresAt: params[6],
          status: params[7],
          metadataJson: params[8],
        });
        return { rows: [row] };
      }

      if (text.includes("FROM creator_post_templates")) {
        return {
          rows: state.creatorPostTemplates
            .filter((row) => row.discord_user_id === params[0])
            .slice()
            .sort((a, b) => {
              if (Boolean(a.is_default) !== Boolean(b.is_default)) {
                return a.is_default ? -1 : 1;
              }
              return b.template_id - a.template_id;
            })
            .map(clone),
        };
      }

      if (text.includes("INSERT INTO creator_post_dispatches")) {
        const row = {
          dispatch_id: state.nextDispatchId,
          discord_user_id: params[0],
          template_id: params[1],
          status: params[2],
          scheduled_at: params[3],
          source_type: params[4],
          source_key: params[5],
          target_platforms_json: JSON.parse(params[6]),
          payload_json: JSON.parse(params[7]),
          error_json: {},
          created_at: "2026-04-08T00:00:00.000Z",
          updated_at: "2026-04-08T00:00:00.000Z",
        };
        state.nextDispatchId += 1;
        state.creatorPostDispatches.push(row);
        return { rows: [clone(row)] };
      }

      if (text.includes("INSERT INTO automation_activity_events")) {
        const row = {
          activity_id: state.nextActivityId,
          discord_user_id: params[0],
          event_type: params[1],
          title: params[2],
          body: params[3],
          severity: params[4],
          platform: params[5],
          dispatch_id: params[6],
          publication_id: params[7],
          source_type: params[8],
          source_key: params[9],
          metadata_json: JSON.parse(params[10]),
          push_status: params[11],
          created_at: "2026-04-08T00:00:00.000Z",
        };
        state.nextActivityId += 1;
        state.automationActivities.push(row);
        return { rows: [clone(row)] };
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
          live_filter_games_json: JSON.parse(params[15]),
          live_filter_languages_json: JSON.parse(params[16]),
          live_filter_min_viewers: params[17],
          live_filter_max_viewers: params[18],
          category_role_routes_json: JSON.parse(params[19]),
          auto_start_thread: params[20],
          auto_start_thread_name: params[21],
          stream_end_message_enabled: params[22],
          stream_end_message_template: params[23],
          updated_at: "2026-04-08T00:00:00.000Z",
        };
        state.guildConfigs.set(params[0], row);
        return { rows: [clone(row)] };
      }

      if (text.includes("ALTER TABLE guild_config") && text.includes("creator_live_alerts")) {
        return { rows: [] };
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

      if (
        text.includes("UPDATE platform_subscriptions") &&
        text.includes("creator_discord_user_id IS NOT DISTINCT FROM $4")
      ) {
        disablePlatformSubscriptions({
          platform: params[0],
          guildId: params[1],
          creatorGuildId: params[2],
          creatorDiscordUserId: params[3],
        });
        return { rows: [] };
      }

      if (
        text.includes("INSERT INTO platform_subscriptions") &&
        text.includes("creator_discord_user_id") &&
        text.includes("callback_url")
      ) {
        const row = upsertPlatformSubscription({
          guildId: params[0],
          creatorGuildId: params[1],
          creatorDiscordUserId: params[2],
          platform: params[3],
          topicKey: params[4],
          callbackUrl: params[5],
          metadataJson: params[6],
        });
        return { rows: [row] };
      }

      throw new Error(`Unexpected query: ${text}`);
    },
    withTransaction: async (runWithClient) =>
      runWithClient({
        query: async (text, params = []) => {
          if (text.includes("UPDATE creator_post_templates") && text.includes("SET is_default = FALSE")) {
            for (const row of state.creatorPostTemplates) {
              if (row.discord_user_id === params[0]) {
                row.is_default = false;
                row.updated_at = "2026-04-08T00:00:00.000Z";
              }
            }
            return { rows: [] };
          }

          if (text.includes("UPDATE creator_post_templates") && text.includes("RETURNING *")) {
            const row = state.creatorPostTemplates.find(
              (item) => item.discord_user_id === params[0] && item.template_id === params[1]
            );
            if (!row) {
              return { rows: [] };
            }
            row.name = params[2];
            row.post_text = params[3];
            row.link_url = params[4];
            row.media_urls_json = JSON.parse(params[5]);
            row.target_platforms_json = JSON.parse(params[6]);
            row.is_default = Boolean(params[7]);
            row.updated_at = "2026-04-08T00:00:00.000Z";
            return { rows: [clone(row)] };
          }

          if (text.includes("INSERT INTO creator_post_templates")) {
            const row = insertCreatorPostTemplate({
              discordUserId: params[0],
              name: params[1],
              postText: params[2],
              linkUrl: params[3],
              mediaUrlsJson: JSON.parse(params[4]),
              targetPlatformsJson: JSON.parse(params[5]),
              isDefault: params[6],
            });
            return { rows: [row] };
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
            const row = upsertPlatformSubscription({
              guildId,
              platform,
              topicKey,
              metadataJson,
            });
            return { rows: [row] };
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

function requestJson(server, method, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: server.address().port,
        method,
        path: pathname,
        headers: {
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
          ...headers,
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode,
            body: raw ? JSON.parse(raw) : null,
          });
        });
      }
    );

    request.on("error", reject);
    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}

run("Lite routes validate channel and creator payloads and keep subscriptions synced", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const state = createResponseState();
  state.platformSubscriptions.push({
    subscription_id: 90,
    guild_id: "guild-1",
    creator_guild_id: null,
    creator_discord_user_id: null,
    platform: "youtube",
    topic_key: "youtube:stale-channel",
    callback_url: null,
    status: "active",
    metadata_json: {
      scope: "lite",
    },
    updated_at: "2026-04-07T00:00:00.000Z",
  });
  require.cache[dbModulePath] = {
    exports: makeDbMock(state),
  };
  require.cache[jobsModulePath] = {
    exports: {
      enqueuePlatformEventIngest: async () => ({ queued: true }),
      enqueuePlatformSubscriptionRenewal: async (...args) => {
        state.renewalCalls.push(args);
        return { queued: true };
      },
      enqueueSocialPostDispatch: async () => ({ queued: true }),
      enqueueMobilePush: async () => ({ queued: true }),
    },
  };

  resetApiModuleCaches();
  const { createServer } = require("../apps/api/src/server");

  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const invalidCreator = await requestJson(
      server,
      "POST",
      "/api/lite/guilds/guild-1/creators",
      {
        platform: "kick",
        url: "https://kick.com/watchme",
      }
    );
    assert.equal(invalidCreator.statusCode, 400);
    assert.equal(invalidCreator.body.error, "Lite only supports twitch, youtube.");

    const invalidChannel = await requestJson(server, "POST", "/api/lite/guilds/guild-1/channel", {});
    assert.equal(invalidChannel.statusCode, 400);
    assert.equal(
      invalidChannel.body.error,
      "Provide an announce_channel_id or live_channel_id"
    );

    const savedChannel = await requestJson(server, "PUT", "/api/lite/guilds/guild-1/channel", {
      announce_channel_id: "channel-1",
    });
    assert.equal(savedChannel.statusCode, 200);
    assert.equal(savedChannel.body.config.guild_id, "guild-1");
    assert.equal(savedChannel.body.config.announce_channel_id, "channel-1");
    assert.equal(savedChannel.body.config.live_channel_id, "channel-1");

    const addCreator = await requestJson(server, "POST", "/api/lite/guilds/guild-1/creators", {
      platform: "YouTube",
      display_name: "WatchMe Live",
      url: " https://youtube.com/@WatchMeLive ",
      external_id: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
      added_by_discord_user_id: "user-1",
    });
    assert.equal(addCreator.statusCode, 200);
    assert.equal(addCreator.body.ok, true);
    assert.equal(addCreator.body.creator.platform, "youtube");
    assert.equal(addCreator.body.capacity.creatorCount, 1);
    assert.equal(addCreator.body.capacity.remaining, 4);
    assert.equal(addCreator.body.subscriptions.length, 1);
    assert.equal(addCreator.body.subscriptions[0].metadata_json.scope, "lite");
    assert.equal(addCreator.body.subscriptions[0].metadata_json.liteCreatorId, 1);
    assert.equal(state.renewalCalls.length, 1);
    assert.equal(state.renewalCalls[0][0], "youtube");
    assert.equal(state.renewalCalls[0][1], "youtube:UC_x5XG1OV2P6uZZ5FSM9Ttw");
    assert.equal(state.renewalCalls[0][2].scope, "lite");
    assert.equal(
      state.platformSubscriptions.find((row) => row.topic_key === "youtube:stale-channel").status,
      "disabled"
    );
    assert.equal(
      state.platformSubscriptions.filter((row) => row.status === "active").length,
      1
    );

    const capacity = await requestJson(server, "GET", "/api/lite/guilds/guild-1/capacity");
    assert.equal(capacity.statusCode, 200);
    assert.equal(capacity.body.creatorCount, 1);
    assert.equal(capacity.body.isFull, false);

    const creators = await requestJson(server, "GET", "/api/lite/guilds/guild-1/creators");
    assert.equal(creators.statusCode, 200);
    assert.equal(creators.body.creators.length, 1);
    assert.equal(creators.body.creators[0].platform, "youtube");
    assert.equal(creators.body.capacity.creatorCount, 1);

    const removed = await requestJson(server, "DELETE", "/api/lite/guilds/guild-1/creators/1");
    assert.equal(removed.statusCode, 200);
    assert.equal(removed.body.ok, true);
    assert.equal(removed.body.capacity.creatorCount, 0);
    assert.equal(removed.body.subscriptions.length, 0);
    assert.equal(state.platformSubscriptions.some((row) => row.status === "active"), false);

    const emptyCreators = await requestJson(server, "GET", "/api/lite/guilds/guild-1/creators");
    assert.equal(emptyCreators.statusCode, 200);
    assert.equal(emptyCreators.body.creators.length, 0);
    assert.equal(emptyCreators.body.capacity.creatorCount, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

run("Lite write routes require a Lite API token when configured", async () => {
  const previousLiteToken = process.env.LITE_API_WRITE_TOKEN;
  const previousToken = process.env.PUBLIC_API_WRITE_TOKEN;
  process.env.LITE_API_WRITE_TOKEN = "test-lite-token";
  process.env.PUBLIC_API_WRITE_TOKEN = "test-write-token";

  const state = createResponseState();
  require.cache[dbModulePath] = {
    exports: makeDbMock(state),
  };
  require.cache[jobsModulePath] = {
    exports: {
      enqueuePlatformEventIngest: async () => ({ queued: true }),
      enqueuePlatformSubscriptionRenewal: async (...args) => {
        state.renewalCalls.push(args);
        return { queued: true };
      },
      enqueueSocialPostDispatch: async () => ({ queued: true }),
      enqueueMobilePush: async () => ({ queued: true }),
    },
  };

  resetApiModuleCaches();
  const { createServer } = require("../apps/api/src/server");

  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const readCapacity = await requestJson(server, "GET", "/api/lite/guilds/guild-1/capacity");
    assert.equal(readCapacity.statusCode, 200);

    const deniedChannel = await requestJson(server, "PUT", "/api/lite/guilds/guild-1/channel", {
      announce_channel_id: "channel-1",
    });
    assert.equal(deniedChannel.statusCode, 401);
    assert.equal(deniedChannel.body.error, "Unauthorized");

    const allowedChannel = await requestJson(
      server,
      "PUT",
      "/api/lite/guilds/guild-1/channel",
      {
        announce_channel_id: "channel-1",
      },
      {
        "x-api-token": "test-lite-token",
      }
    );
    assert.equal(allowedChannel.statusCode, 200);
    assert.equal(allowedChannel.body.config.announce_channel_id, "channel-1");

    const deniedCreator = await requestJson(server, "POST", "/api/lite/guilds/guild-1/creators", {
      platform: "youtube",
      display_name: "WatchMe Live",
      url: "https://youtube.com/@WatchMeLive",
      external_id: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
      added_by_discord_user_id: "user-1",
    });
    assert.equal(deniedCreator.statusCode, 401);
    assert.equal(deniedCreator.body.error, "Unauthorized");

    const allowedCreator = await requestJson(
      server,
      "POST",
      "/api/lite/guilds/guild-1/creators",
      {
        platform: "youtube",
        display_name: "WatchMe Live",
        url: "https://youtube.com/@WatchMeLive",
        external_id: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
        added_by_discord_user_id: "user-1",
      },
      {
        "x-api-token": "test-lite-token",
      }
    );
    assert.equal(allowedCreator.statusCode, 200);
    assert.equal(allowedCreator.body.ok, true);
    const createdLiteCreatorId = allowedCreator.body.creator.lite_creator_id;

    const deniedDelete = await requestJson(
      server,
      "DELETE",
      `/api/lite/guilds/guild-1/creators/${createdLiteCreatorId}`
    );
    assert.equal(deniedDelete.statusCode, 401);
    assert.equal(deniedDelete.body.error, "Unauthorized");

    const allowedDelete = await requestJson(
      server,
      "DELETE",
      `/api/lite/guilds/guild-1/creators/${createdLiteCreatorId}`,
      undefined,
      {
        "x-api-token": "test-lite-token",
      }
    );
    assert.equal(allowedDelete.statusCode, 200);
    assert.equal(allowedDelete.body.ok, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousLiteToken === undefined) {
      delete process.env.LITE_API_WRITE_TOKEN;
    } else {
      process.env.LITE_API_WRITE_TOKEN = previousLiteToken;
    }
    if (previousToken === undefined) {
      delete process.env.PUBLIC_API_WRITE_TOKEN;
    } else {
      process.env.PUBLIC_API_WRITE_TOKEN = previousToken;
    }
  }
});

run("Lite write routes can use a dedicated token without granting broader guild writes", async () => {
  const previousLiteToken = process.env.LITE_API_WRITE_TOKEN;
  const previousToken = process.env.PUBLIC_API_WRITE_TOKEN;
  process.env.LITE_API_WRITE_TOKEN = "test-lite-token";
  process.env.PUBLIC_API_WRITE_TOKEN = "test-write-token";

  const state = createResponseState();
  require.cache[dbModulePath] = {
    exports: makeDbMock(state),
  };
  require.cache[jobsModulePath] = {
    exports: {
      enqueuePlatformEventIngest: async () => ({ queued: true }),
      enqueuePlatformSubscriptionRenewal: async (...args) => {
        state.renewalCalls.push(args);
        return { queued: true };
      },
      enqueueSocialPostDispatch: async () => ({ queued: true }),
      enqueueMobilePush: async () => ({ queued: true }),
    },
  };

  resetApiModuleCaches();
  const { createServer } = require("../apps/api/src/server");

  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const liteWithPublicToken = await requestJson(
      server,
      "PUT",
      "/api/lite/guilds/guild-1/channel",
      {
        announce_channel_id: "channel-1",
      },
      {
        "x-api-token": "test-write-token",
      }
    );
    assert.equal(liteWithPublicToken.statusCode, 401);
    assert.equal(liteWithPublicToken.body.error, "Unauthorized");

    const guildConfigWithLiteToken = await requestJson(
      server,
      "PUT",
      "/api/guilds/guild-1/config",
      {
        announce_channel_id: "channel-1",
      },
      {
        "x-api-token": "test-lite-token",
      }
    );
    assert.equal(guildConfigWithLiteToken.statusCode, 401);
    assert.equal(guildConfigWithLiteToken.body.error, "Unauthorized");

    const guildConfigWithPublicToken = await requestJson(
      server,
      "PUT",
      "/api/guilds/guild-1/config",
      {
        announce_channel_id: "channel-1",
      },
      {
        "x-api-token": "test-write-token",
      }
    );
    assert.equal(guildConfigWithPublicToken.statusCode, 200);
    assert.equal(guildConfigWithPublicToken.body.config.announce_channel_id, "channel-1");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousLiteToken === undefined) {
      delete process.env.LITE_API_WRITE_TOKEN;
    } else {
      process.env.LITE_API_WRITE_TOKEN = previousLiteToken;
    }
    if (previousToken === undefined) {
      delete process.env.PUBLIC_API_WRITE_TOKEN;
    } else {
      process.env.PUBLIC_API_WRITE_TOKEN = previousToken;
    }
  }
});

run("Mobile post-builder routes can fall back to a dedicated app token without granting broader guild writes", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousMobileToken = process.env.MOBILE_API_WRITE_TOKEN;
  const previousMobileSessionRequired = process.env.MOBILE_SESSION_REQUIRED;
  const previousMobileSessionSecret = process.env.MOBILE_SESSION_SECRET;
  const previousPublicToken = process.env.PUBLIC_API_WRITE_TOKEN;
  process.env.NODE_ENV = "development";
  process.env.MOBILE_API_WRITE_TOKEN = "test-mobile-token";
  delete process.env.MOBILE_SESSION_REQUIRED;
  delete process.env.MOBILE_SESSION_SECRET;
  process.env.PUBLIC_API_WRITE_TOKEN = "test-write-token";

  const state = createResponseState();
  state.creatorIdentities.set("user-1", {
    discord_user_id: "user-1",
    display_name: "WatchMe Creator",
  });
  require.cache[dbModulePath] = {
    exports: makeDbMock(state),
  };
  require.cache[jobsModulePath] = {
    exports: {
      enqueuePlatformEventIngest: async () => ({ queued: true }),
      enqueuePlatformSubscriptionRenewal: async (...args) => {
        state.renewalCalls.push(args);
        return { queued: true };
      },
      enqueueSocialPostDispatch: async () => ({ queued: true }),
      enqueueMobilePush: async () => ({ queued: true }),
    },
  };

  resetApiModuleCaches();
  const { createServer } = require("../apps/api/src/server");

  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const deniedBuilder = await requestJson(server, "GET", "/api/mobile/creators/user-1/post-builder");
    assert.equal(deniedBuilder.statusCode, 401);
    assert.equal(deniedBuilder.body.error, "Unauthorized");

    const builderWithPublicToken = await requestJson(
      server,
      "GET",
      "/api/mobile/creators/user-1/post-builder",
      undefined,
      {
        "x-api-token": "test-write-token",
      }
    );
    assert.equal(builderWithPublicToken.statusCode, 401);
    assert.equal(builderWithPublicToken.body.error, "Unauthorized");

    const builderWithMobileToken = await requestJson(
      server,
      "GET",
      "/api/mobile/creators/user-1/post-builder",
      undefined,
      {
        "x-api-token": "test-mobile-token",
      }
    );
    assert.equal(builderWithMobileToken.statusCode, 200);
    assert.equal(builderWithMobileToken.body.ok, true);
    assert.equal(builderWithMobileToken.body.discord_user_id, "user-1");
    assert.equal(builderWithMobileToken.body.connections.length, 0);
    assert.equal(builderWithMobileToken.body.templates.length, 0);

    const deniedTemplate = await requestJson(
      server,
      "POST",
      "/api/mobile/creators/user-1/post-builder/templates",
      {
        name: "Launch post",
        post_text: "WatchMe is live",
        target_platforms_json: ["facebook"],
      },
      {
        "x-api-token": "test-write-token",
      }
    );
    assert.equal(deniedTemplate.statusCode, 401);
    assert.equal(deniedTemplate.body.error, "Unauthorized");

    const allowedTemplate = await requestJson(
      server,
      "POST",
      "/api/mobile/creators/user-1/post-builder/templates",
      {
        name: "Launch post",
        post_text: "WatchMe is live",
        target_platforms_json: ["facebook"],
        is_default: true,
      },
      {
        "x-api-token": "test-mobile-token",
      }
    );
    assert.equal(allowedTemplate.statusCode, 200);
    assert.equal(allowedTemplate.body.ok, true);
    assert.equal(allowedTemplate.body.template.name, "Launch post");
    assert.deepEqual(allowedTemplate.body.template.target_platforms_json, ["facebook"]);

    const deniedConnection = await requestJson(
      server,
      "PUT",
      "/api/mobile/creators/user-1/post-builder/connections/facebook",
      {
        external_account_id: "page-1",
        external_account_name: "WatchMe Page",
        access_token: "secret-token",
      },
      {
        "x-api-token": "test-write-token",
      }
    );
    assert.equal(deniedConnection.statusCode, 401);
    assert.equal(deniedConnection.body.error, "Unauthorized");

    const allowedConnection = await requestJson(
      server,
      "PUT",
      "/api/mobile/creators/user-1/post-builder/connections/facebook",
      {
        external_account_id: "page-1",
        external_account_name: "WatchMe Page",
        access_token: "secret-token",
        metadata_json: {
          page_id: "page-1",
        },
      },
      {
        "x-api-token": "test-mobile-token",
      }
    );
    assert.equal(allowedConnection.statusCode, 200);
    assert.equal(allowedConnection.body.ok, true);
    assert.equal(allowedConnection.body.connection.platform, "facebook");
    assert.equal(allowedConnection.body.connection.external_account_id, "page-1");

    const deniedPublish = await requestJson(
      server,
      "POST",
      "/api/mobile/creators/user-1/post-builder/publish",
      {
        post_text: "WatchMe update",
        target_platforms_json: ["facebook"],
      },
      {
        "x-api-token": "test-write-token",
      }
    );
    assert.equal(deniedPublish.statusCode, 401);
    assert.equal(deniedPublish.body.error, "Unauthorized");

    const allowedPublish = await requestJson(
      server,
      "POST",
      "/api/mobile/creators/user-1/post-builder/publish",
      {
        post_text: "WatchMe update",
        target_platforms_json: ["facebook"],
      },
      {
        "x-api-token": "test-mobile-token",
      }
    );
    assert.equal(allowedPublish.statusCode, 202);
    assert.equal(allowedPublish.body.ok, true);
    assert.equal(state.creatorPostDispatches.length, 1);
    assert.deepEqual(state.creatorPostDispatches[0].target_platforms_json, ["facebook"]);

    const scheduledPublish = await requestJson(
      server,
      "POST",
      "/api/mobile/creators/user-1/post-builder/publish",
      {
        post_text: "Scheduled WatchMe update",
        scheduled_at: "2026-05-01T12:30:00.000Z",
      },
      {
        "x-api-token": "test-mobile-token",
      }
    );
    assert.equal(scheduledPublish.statusCode, 202);
    assert.equal(state.creatorPostDispatches.length, 2);
    assert.equal(state.creatorPostDispatches[1].status, "scheduled");
    assert.equal(state.creatorPostDispatches[1].scheduled_at, "2026-05-01T12:30:00.000Z");
    assert.deepEqual(state.creatorPostDispatches[1].target_platforms_json, ["facebook"]);

    const guildConfigWithMobileToken = await requestJson(
      server,
      "PUT",
      "/api/guilds/guild-1/config",
      {
        announce_channel_id: "channel-1",
      },
      {
        "x-api-token": "test-mobile-token",
      }
    );
    assert.equal(guildConfigWithMobileToken.statusCode, 401);
    assert.equal(guildConfigWithMobileToken.body.error, "Unauthorized");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousMobileToken === undefined) {
      delete process.env.MOBILE_API_WRITE_TOKEN;
    } else {
      process.env.MOBILE_API_WRITE_TOKEN = previousMobileToken;
    }
    if (previousPublicToken === undefined) {
      delete process.env.PUBLIC_API_WRITE_TOKEN;
    } else {
      process.env.PUBLIC_API_WRITE_TOKEN = previousPublicToken;
    }
    if (previousMobileSessionRequired === undefined) {
      delete process.env.MOBILE_SESSION_REQUIRED;
    } else {
      process.env.MOBILE_SESSION_REQUIRED = previousMobileSessionRequired;
    }
    if (previousMobileSessionSecret === undefined) {
      delete process.env.MOBILE_SESSION_SECRET;
    } else {
      process.env.MOBILE_SESSION_SECRET = previousMobileSessionSecret;
    }
  }
});

run("Mobile post-builder routes require a matching signed user session when configured", async () => {
  const previousMobileToken = process.env.MOBILE_API_WRITE_TOKEN;
  const previousMobileSessionRequired = process.env.MOBILE_SESSION_REQUIRED;
  const previousMobileSessionSecret = process.env.MOBILE_SESSION_SECRET;
  const previousPublicToken = process.env.PUBLIC_API_WRITE_TOKEN;
  process.env.MOBILE_API_WRITE_TOKEN = "test-mobile-token";
  process.env.MOBILE_SESSION_REQUIRED = "1";
  process.env.MOBILE_SESSION_SECRET = "test-mobile-session-secret";
  process.env.PUBLIC_API_WRITE_TOKEN = "test-write-token";

  const state = createResponseState();
  state.creatorIdentities.set("user-1", {
    discord_user_id: "user-1",
    display_name: "WatchMe Creator",
  });
  require.cache[dbModulePath] = {
    exports: makeDbMock(state),
  };
  require.cache[jobsModulePath] = {
    exports: {
      enqueuePlatformEventIngest: async () => ({ queued: true }),
      enqueuePlatformSubscriptionRenewal: async (...args) => {
        state.renewalCalls.push(args);
        return { queued: true };
      },
      enqueueSocialPostDispatch: async () => ({ queued: true }),
      enqueueMobilePush: async () => ({ queued: true }),
    },
  };

  resetApiModuleCaches();
  const { createServer } = require("../apps/api/src/server");

  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));

  const nowSeconds = Math.floor(Date.now() / 1000);
  const validToken = createMobileSessionToken({
    discordUserId: "user-1",
    secret: "test-mobile-session-secret",
    issuedAtSeconds: nowSeconds,
    expiresAtSeconds: nowSeconds + 3600,
  });
  const wrongUserToken = createMobileSessionToken({
    discordUserId: "user-2",
    secret: "test-mobile-session-secret",
    issuedAtSeconds: nowSeconds,
    expiresAtSeconds: nowSeconds + 3600,
  });

  try {
    const deniedBuilder = await requestJson(server, "GET", "/api/mobile/creators/user-1/post-builder");
    assert.equal(deniedBuilder.statusCode, 401);
    assert.equal(deniedBuilder.body.error, "Unauthorized");

    const builderWithMobileToken = await requestJson(
      server,
      "GET",
      "/api/mobile/creators/user-1/post-builder",
      undefined,
      {
        "x-api-token": "test-mobile-token",
      }
    );
    assert.equal(builderWithMobileToken.statusCode, 401);
    assert.equal(builderWithMobileToken.body.error, "Unauthorized");

    const builderWithWrongUserToken = await requestJson(
      server,
      "GET",
      "/api/mobile/creators/user-1/post-builder",
      undefined,
      {
        Authorization: `Bearer ${wrongUserToken}`,
      }
    );
    assert.equal(builderWithWrongUserToken.statusCode, 401);
    assert.equal(builderWithWrongUserToken.body.error, "Unauthorized");

    const builderWithValidSession = await requestJson(
      server,
      "GET",
      "/api/mobile/creators/user-1/post-builder",
      undefined,
      {
        Authorization: `Bearer ${validToken}`,
      }
    );
    assert.equal(builderWithValidSession.statusCode, 200);
    assert.equal(builderWithValidSession.body.ok, true);
    assert.equal(builderWithValidSession.body.discord_user_id, "user-1");

    const connectionWithSession = await requestJson(
      server,
      "PUT",
      "/api/mobile/creators/user-1/post-builder/connections/instagram",
      {
        external_account_id: "ig-1",
        external_account_name: "WatchMe IG",
        access_token: "secret-token",
      },
      {
        Authorization: `Bearer ${validToken}`,
      }
    );
    assert.equal(connectionWithSession.statusCode, 200);
    assert.equal(connectionWithSession.body.ok, true);
    assert.equal(connectionWithSession.body.connection.platform, "instagram");

    const publishWithSession = await requestJson(
      server,
      "POST",
      "/api/mobile/creators/user-1/post-builder/publish",
      {
        post_text: "WatchMe update",
        target_platforms_json: ["instagram"],
      },
      {
        Authorization: `Bearer ${validToken}`,
      }
    );
    assert.equal(publishWithSession.statusCode, 202);
    assert.equal(publishWithSession.body.ok, true);

    const guildConfigWithSignedSession = await requestJson(
      server,
      "PUT",
      "/api/guilds/guild-1/config",
      {
        announce_channel_id: "channel-1",
      },
      {
        Authorization: `Bearer ${validToken}`,
      }
    );
    assert.equal(guildConfigWithSignedSession.statusCode, 401);
    assert.equal(guildConfigWithSignedSession.body.error, "Unauthorized");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousMobileToken === undefined) {
      delete process.env.MOBILE_API_WRITE_TOKEN;
    } else {
      process.env.MOBILE_API_WRITE_TOKEN = previousMobileToken;
    }
    if (previousPublicToken === undefined) {
      delete process.env.PUBLIC_API_WRITE_TOKEN;
    } else {
      process.env.PUBLIC_API_WRITE_TOKEN = previousPublicToken;
    }
    if (previousMobileSessionRequired === undefined) {
      delete process.env.MOBILE_SESSION_REQUIRED;
    } else {
      process.env.MOBILE_SESSION_REQUIRED = previousMobileSessionRequired;
    }
    if (previousMobileSessionSecret === undefined) {
      delete process.env.MOBILE_SESSION_SECRET;
    } else {
      process.env.MOBILE_SESSION_SECRET = previousMobileSessionSecret;
    }
  }
});

run("Lite write routes fail closed in production when no write token is configured", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousLiteToken = process.env.LITE_API_WRITE_TOKEN;
  const previousPublicToken = process.env.PUBLIC_API_WRITE_TOKEN;
  const previousSessionSecret = process.env.SESSION_SECRET;
  process.env.NODE_ENV = "production";
  delete process.env.LITE_API_WRITE_TOKEN;
  delete process.env.PUBLIC_API_WRITE_TOKEN;
  delete process.env.SESSION_SECRET;

  const state = createResponseState();
  require.cache[dbModulePath] = {
    exports: makeDbMock(state),
  };
  require.cache[jobsModulePath] = {
    exports: {
      enqueuePlatformEventIngest: async () => ({ queued: true }),
      enqueuePlatformSubscriptionRenewal: async (...args) => {
        state.renewalCalls.push(args);
        return { queued: true };
      },
      enqueueSocialPostDispatch: async () => ({ queued: true }),
      enqueueMobilePush: async () => ({ queued: true }),
    },
  };

  resetApiModuleCaches();
  const { createServer } = require("../apps/api/src/server");

  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const readCapacity = await requestJson(server, "GET", "/api/lite/guilds/guild-1/capacity");
    assert.equal(readCapacity.statusCode, 200);

    const deniedChannel = await requestJson(server, "PUT", "/api/lite/guilds/guild-1/channel", {
      announce_channel_id: "channel-1",
    });
    assert.equal(deniedChannel.statusCode, 401);
    assert.equal(deniedChannel.body.error, "Unauthorized");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousLiteToken === undefined) {
      delete process.env.LITE_API_WRITE_TOKEN;
    } else {
      process.env.LITE_API_WRITE_TOKEN = previousLiteToken;
    }
    if (previousPublicToken === undefined) {
      delete process.env.PUBLIC_API_WRITE_TOKEN;
    } else {
      process.env.PUBLIC_API_WRITE_TOKEN = previousPublicToken;
    }
    if (previousSessionSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = previousSessionSecret;
    }
  }
});

run("Mobile routes fail closed in production when no mobile or fallback token is configured", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousMobileToken = process.env.MOBILE_API_WRITE_TOKEN;
  const previousPublicToken = process.env.PUBLIC_API_WRITE_TOKEN;
  const previousSessionSecret = process.env.SESSION_SECRET;
  process.env.NODE_ENV = "production";
  delete process.env.MOBILE_API_WRITE_TOKEN;
  delete process.env.PUBLIC_API_WRITE_TOKEN;
  delete process.env.SESSION_SECRET;

  const state = createResponseState();
  require.cache[dbModulePath] = {
    exports: makeDbMock(state),
  };
  require.cache[jobsModulePath] = {
    exports: {
      enqueuePlatformEventIngest: async () => ({ queued: true }),
      enqueuePlatformSubscriptionRenewal: async (...args) => {
        state.renewalCalls.push(args);
        return { queued: true };
      },
      enqueueSocialPostDispatch: async () => ({ queued: true }),
      enqueueMobilePush: async () => ({ queued: true }),
    },
  };

  resetApiModuleCaches();
  const { createServer } = require("../apps/api/src/server");

  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const deniedBuilder = await requestJson(server, "GET", "/api/mobile/creators/user-1/post-builder");
    assert.equal(deniedBuilder.statusCode, 401);
    assert.equal(deniedBuilder.body.error, "Unauthorized");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousMobileToken === undefined) {
      delete process.env.MOBILE_API_WRITE_TOKEN;
    } else {
      process.env.MOBILE_API_WRITE_TOKEN = previousMobileToken;
    }
    if (previousPublicToken === undefined) {
      delete process.env.PUBLIC_API_WRITE_TOKEN;
    } else {
      process.env.PUBLIC_API_WRITE_TOKEN = previousPublicToken;
    }
    if (previousSessionSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = previousSessionSecret;
    }
  }
});

run("Mobile routes require a signed session in production even when a mobile token is configured", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousMobileToken = process.env.MOBILE_API_WRITE_TOKEN;
  const previousPublicToken = process.env.PUBLIC_API_WRITE_TOKEN;
  const previousSessionSecret = process.env.SESSION_SECRET;
  const previousMobileSessionSecret = process.env.MOBILE_SESSION_SECRET;
  const previousMobileSessionRequired = process.env.MOBILE_SESSION_REQUIRED;
  process.env.NODE_ENV = "production";
  process.env.MOBILE_API_WRITE_TOKEN = "test-mobile-token";
  delete process.env.PUBLIC_API_WRITE_TOKEN;
  delete process.env.SESSION_SECRET;
  process.env.MOBILE_SESSION_SECRET = "test-mobile-session-secret";
  delete process.env.MOBILE_SESSION_REQUIRED;

  const state = createResponseState();
  require.cache[dbModulePath] = {
    exports: makeDbMock(state),
  };
  require.cache[jobsModulePath] = {
    exports: {
      enqueuePlatformEventIngest: async () => ({ queued: true }),
      enqueuePlatformSubscriptionRenewal: async (...args) => {
        state.renewalCalls.push(args);
        return { queued: true };
      },
      enqueueSocialPostDispatch: async () => ({ queued: true }),
      enqueueMobilePush: async () => ({ queued: true }),
    },
  };

  resetApiModuleCaches();
  const { createServer } = require("../apps/api/src/server");

  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const deniedBuilder = await requestJson(
      server,
      "GET",
      "/api/mobile/creators/user-1/post-builder",
      undefined,
      {
        "x-api-token": "test-mobile-token",
      }
    );
    assert.equal(deniedBuilder.statusCode, 401);
    assert.equal(deniedBuilder.body.error, "Unauthorized");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousMobileToken === undefined) {
      delete process.env.MOBILE_API_WRITE_TOKEN;
    } else {
      process.env.MOBILE_API_WRITE_TOKEN = previousMobileToken;
    }
    if (previousPublicToken === undefined) {
      delete process.env.PUBLIC_API_WRITE_TOKEN;
    } else {
      process.env.PUBLIC_API_WRITE_TOKEN = previousPublicToken;
    }
    if (previousSessionSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = previousSessionSecret;
    }
    if (previousMobileSessionSecret === undefined) {
      delete process.env.MOBILE_SESSION_SECRET;
    } else {
      process.env.MOBILE_SESSION_SECRET = previousMobileSessionSecret;
    }
    if (previousMobileSessionRequired === undefined) {
      delete process.env.MOBILE_SESSION_REQUIRED;
    } else {
      process.env.MOBILE_SESSION_REQUIRED = previousMobileSessionRequired;
    }
  }
});

run("Internal mobile session issue route returns a signed user session", async () => {
  const previousInternalToken = process.env.INTERNAL_API_TOKEN;
  const previousMobileSessionSecret = process.env.MOBILE_SESSION_SECRET;
  const previousSessionSecret = process.env.SESSION_SECRET;
  process.env.INTERNAL_API_TOKEN = "test-internal-token";
  process.env.MOBILE_SESSION_SECRET = "test-mobile-session-secret";
  delete process.env.SESSION_SECRET;

  const state = createResponseState();
  require.cache[dbModulePath] = {
    exports: makeDbMock(state),
  };
  require.cache[jobsModulePath] = {
    exports: {
      enqueuePlatformEventIngest: async () => ({ queued: true }),
      enqueuePlatformSubscriptionRenewal: async (...args) => {
        state.renewalCalls.push(args);
        return { queued: true };
      },
      enqueueSocialPostDispatch: async () => ({ queued: true }),
      enqueueMobilePush: async () => ({ queued: true }),
    },
  };

  resetApiModuleCaches();
  const { createServer } = require("../apps/api/src/server");

  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const deniedIssue = await requestJson(server, "POST", "/api/internal/mobile-sessions", {
      discord_user_id: "user-1",
    });
    assert.equal(deniedIssue.statusCode, 401);
    assert.equal(deniedIssue.body.error, "Unauthorized");

    const issued = await requestJson(
      server,
      "POST",
      "/api/internal/mobile-sessions",
      {
        discord_user_id: "user-1",
        ttl_seconds: 600,
      },
      {
        "x-internal-token": "test-internal-token",
      }
    );
    assert.equal(issued.statusCode, 201);
    assert.equal(issued.body.ok, true);
    assert.equal(issued.body.session.discordUserId, "user-1");
    assert.equal(issued.body.session.expiresInSeconds, 600);

    const verification = require("../apps/api/src/mobile-auth").verifyMobileSessionToken(
      issued.body.session.token,
      "test-mobile-session-secret",
      Math.floor(Date.parse(issued.body.session.issuedAt) / 1000) + 1
    );
    assert.equal(verification.ok, true);
    assert.equal(verification.discordUserId, "user-1");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousInternalToken === undefined) {
      delete process.env.INTERNAL_API_TOKEN;
    } else {
      process.env.INTERNAL_API_TOKEN = previousInternalToken;
    }
    if (previousMobileSessionSecret === undefined) {
      delete process.env.MOBILE_SESSION_SECRET;
    } else {
      process.env.MOBILE_SESSION_SECRET = previousMobileSessionSecret;
    }
    if (previousSessionSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = previousSessionSecret;
    }
  }
});

run("Internal ops routes fail closed in production when no internal token is configured", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousInternalToken = process.env.INTERNAL_API_TOKEN;
  const previousSessionSecret = process.env.SESSION_SECRET;
  process.env.NODE_ENV = "production";
  delete process.env.INTERNAL_API_TOKEN;
  delete process.env.SESSION_SECRET;

  const state = createResponseState();
  require.cache[dbModulePath] = {
    exports: makeDbMock(state),
  };
  require.cache[jobsModulePath] = {
    exports: {
      enqueuePlatformEventIngest: async () => ({ queued: true }),
      enqueuePlatformSubscriptionRenewal: async (...args) => {
        state.renewalCalls.push(args);
        return { queued: true };
      },
      enqueueSocialPostDispatch: async () => ({ queued: true }),
      enqueueMobilePush: async () => ({ queued: true }),
    },
  };

  resetApiModuleCaches();
  const { createServer } = require("../apps/api/src/server");

  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const health = await requestJson(server, "GET", "/api/health");
    assert.equal(health.statusCode, 200);

    const deniedOps = await requestJson(server, "GET", "/api/internal/ops/queues");
    assert.equal(deniedOps.statusCode, 401);
    assert.equal(deniedOps.body.error, "Unauthorized");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousInternalToken === undefined) {
      delete process.env.INTERNAL_API_TOKEN;
    } else {
      process.env.INTERNAL_API_TOKEN = previousInternalToken;
    }
    if (previousSessionSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = previousSessionSecret;
    }
  }
});

queue
  .then(() => {
    if (process.exitCode) {
      process.exit(process.exitCode);
    }
  })
  .catch((error) => {
    console.error(error?.stack || error);
    process.exit(1);
  });
