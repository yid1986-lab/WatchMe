const assert = require("node:assert/strict");
const path = require("node:path");

const dbModulePath = path.resolve(__dirname, "../apps/api/src/db.js");
const queriesModulePath = path.resolve(__dirname, "../apps/api/src/queries.js");

function run(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS ${name}`);
    })
    .catch((error) => {
      console.error(`FAIL ${name}`);
      console.error(error?.stack || error);
      process.exitCode = 1;
    });
}

run("syncLitePlatformSubscriptions keeps one active row per lite topic", async () => {
  const state = {
    ensuredGuilds: [],
    activeSubscriptions: [
      {
        subscription_id: 90,
        guild_id: "guild-1",
        creator_guild_id: null,
        creator_discord_user_id: null,
        platform: "youtube",
        topic_key: "youtube:stale-channel",
        status: "active",
        metadata_json: {
          scope: "lite",
        },
      },
    ],
    liteCreators: [
      {
        lite_creator_id: 1,
        guild_id: "guild-1",
        platform: "youtube",
        display_name: "WatchMe Live",
        url: "https://youtube.com/@WatchMeLive",
        external_id: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
        added_by_discord_user_id: "user-1",
      },
      {
        lite_creator_id: 2,
        guild_id: "guild-1",
        platform: "twitch",
        display_name: "WatchMe Twitch",
        url: "https://twitch.tv/watchme",
        external_id: "479277594",
        added_by_discord_user_id: "user-2",
      },
    ],
    disabledCalls: [],
    insertedRows: [],
  };

  require.cache[dbModulePath] = {
    exports: {
      query: async (text, params = []) => {
        if (text.includes("INSERT INTO guilds")) {
          state.ensuredGuilds.push(params[0]);
          return { rows: [{ guild_id: params[0] }] };
        }

        throw new Error(`Unexpected top-level query: ${text}`);
      },
      withTransaction: async (runWithClient) =>
        runWithClient({
          query: async (text, params = []) => {
            if (text.includes("FROM lite_creators")) {
              return { rows: state.liteCreators };
            }

            if (text.includes("AND topic_key <> ALL")) {
              state.disabledCalls.push({
                platform: params[0],
                guildId: params[1],
                keepTopicKeys: params[2],
              });
              return { rows: [] };
            }

            if (text.includes("AND COALESCE(metadata_json->>'scope', '') = 'lite'") && text.includes("SET")) {
              state.disabledCalls.push({
                platform: params[0],
                guildId: params[1],
                keepTopicKeys: [],
              });
              return { rows: [] };
            }

            if (text.includes("INSERT INTO platform_subscriptions")) {
              const row = {
                subscription_id: state.insertedRows.length + 1,
                guild_id: params[0],
                creator_guild_id: null,
                creator_discord_user_id: null,
                platform: params[1],
                topic_key: params[2],
                status: "active",
                metadata_json: JSON.parse(params[3]),
              };
              state.insertedRows.push(row);
              return { rows: [row] };
            }

            if (text.includes("FROM platform_subscriptions")) {
              return {
                rows: state.insertedRows.slice().sort((a, b) => {
                  return `${a.platform}:${a.topic_key}`.localeCompare(`${b.platform}:${b.topic_key}`);
                }),
              };
            }

            throw new Error(`Unexpected transaction query: ${text}`);
          },
        }),
    },
  };

  delete require.cache[queriesModulePath];
  const { syncLitePlatformSubscriptions } = require("../apps/api/src/queries");

  const subscriptions = await syncLitePlatformSubscriptions("guild-1");

  assert.deepEqual(state.ensuredGuilds, ["guild-1"]);
  assert.equal(subscriptions.length, 2);
  assert.deepEqual(
    subscriptions.map((row) => `${row.platform}:${row.topic_key}`),
    [
      "twitch:twitch:479277594",
      "youtube:youtube:UC_x5XG1OV2P6uZZ5FSM9Ttw",
    ]
  );
  assert.deepEqual(
    state.disabledCalls,
    [
      {
        platform: "twitch",
        guildId: "guild-1",
        keepTopicKeys: ["twitch:479277594"],
      },
      {
        platform: "youtube",
        guildId: "guild-1",
        keepTopicKeys: ["youtube:UC_x5XG1OV2P6uZZ5FSM9Ttw"],
      },
    ]
  );
  assert.equal(state.insertedRows[1].metadata_json.scope, "lite");
  assert.equal(state.insertedRows[1].metadata_json.liteCreatorId, 1);
});

process.on("beforeExit", () => {
  if (process.exitCode) {
    process.exit(process.exitCode);
  }
});
