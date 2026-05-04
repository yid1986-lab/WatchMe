const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { runLiteCutoverPreflight } = require("../src/cutover-preflight");

function withEnv(overrides, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function createPreflightServer() {
  const state = {
    guildConfig: {
      guild_id: "preflight-guild",
      announce_channel_id: "channel-123",
    },
    creators: [
      { lite_creator_id: 1, platform: "twitch", display_name: "Creator 1" },
      { lite_creator_id: 2, platform: "youtube", display_name: "Creator 2" },
    ],
    nextLiteCreatorId: 3,
  };

  const server = http.createServer(async (req, res) => {
    const { method, url } = req;

    if (method === "GET" && url === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "watchme-v2-api" }));
      return;
    }

    if (method === "GET" && url === "/api/guilds/preflight-guild/config") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(state.guildConfig));
      return;
    }

    if (method === "PUT" && url === "/api/lite/guilds/preflight-guild/channel") {
      const body = await readJson(req);
      state.guildConfig = {
        guild_id: "preflight-guild",
        announce_channel_id: body.announce_channel_id,
        live_channel_id: body.live_channel_id,
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, config: state.guildConfig }));
      return;
    }

    if (method === "GET" && url === "/api/lite/guilds/preflight-guild/capacity") {
      const creatorCount = state.creators.length;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ creatorCount, remaining: Math.max(0, 5 - creatorCount), isFull: creatorCount >= 5 }));
      return;
    }

    if (method === "GET" && url === "/api/lite/guilds/preflight-guild/creators") {
      const creatorCount = state.creators.length;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          creators: state.creators,
          capacity: { creatorCount, remaining: Math.max(0, 5 - creatorCount), isFull: creatorCount >= 5 },
        })
      );
      return;
    }

    if (method === "POST" && url === "/api/lite/guilds/preflight-guild/creators") {
      const body = await readJson(req);
      const creator = {
        lite_creator_id: state.nextLiteCreatorId,
        platform: body.platform,
        display_name: body.display_name,
        url: body.url,
        external_id: body.external_id,
      };
      state.nextLiteCreatorId += 1;
      state.creators.push(creator);
      const creatorCount = state.creators.length;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          creator,
          capacity: { creatorCount, remaining: Math.max(0, 5 - creatorCount), isFull: creatorCount >= 5 },
        })
      );
      return;
    }

    if (method === "DELETE" && url.startsWith("/api/lite/guilds/preflight-guild/creators/")) {
      const liteCreatorId = Number(url.split("/").pop());
      state.creators = state.creators.filter((creator) => creator.lite_creator_id !== liteCreatorId);
      const creatorCount = state.creators.length;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          capacity: { creatorCount, remaining: Math.max(0, 5 - creatorCount), isFull: creatorCount >= 5 },
        })
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return { server, state };
}

test("Lite cutover preflight validates configured API health and guild reads", async () => {
  const { server } = createPreflightServer();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    await withEnv(
      {
        LITE_DISCORD_TOKEN: "lite-v2-token",
        LITE_API_WRITE_TOKEN: "lite-v2-write-token",
        LITE_API_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      },
      async () => {
        const result = await runLiteCutoverPreflight({ guildId: "preflight-guild" });

        assert.equal(result.ok, true);
        assert.equal(result.mode, "cutover-preflight");
        assert.equal(result.health.service, "watchme-v2-api");
        assert.equal(result.guildConfig.announce_channel_id, "channel-123");
        assert.equal(result.capacity.creatorCount, 2);
        assert.equal(result.creatorCount, 2);
        assert.equal(result.writeCycle, null);
      }
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Lite cutover preflight can run a disposable protected write cycle", async () => {
  const { server, state } = createPreflightServer();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    await withEnv(
      {
        LITE_DISCORD_TOKEN: "lite-v2-token",
        LITE_API_WRITE_TOKEN: "lite-v2-write-token",
        LITE_API_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      },
      async () => {
        const result = await runLiteCutoverPreflight({
          guildId: "preflight-guild",
          allowWrites: true,
        });

        assert.equal(result.writeCycle.savedChannelId, "preflight-channel-preflight-guild");
        assert.equal(result.writeCycle.creatorCountAfterAdd, 3);
        assert.equal(result.writeCycle.creatorCountAfterCleanup, 2);
        assert.equal(result.writeCycle.capacityAfterAdd, 3);
        assert.equal(result.writeCycle.capacityAfterCleanup, 2);
        assert.equal(state.creators.length, 2);
        assert.equal(state.guildConfig.announce_channel_id, "channel-123");
        assert.equal(state.guildConfig.live_channel_id, "channel-123");
      }
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Lite cutover preflight fails fast when required cutover env is missing", async () => {
  await withEnv(
    {
      DISCORD_TOKEN: undefined,
      DISCORD_BOT_TOKEN: undefined,
      LITE_DISCORD_TOKEN: undefined,
      LITE_API_WRITE_TOKEN: undefined,
      PUBLIC_API_WRITE_TOKEN: undefined,
      SESSION_SECRET: undefined,
    },
    async () => {
      await assert.rejects(
        runLiteCutoverPreflight({ guildId: "preflight-guild" }),
        (error) =>
          Array.isArray(error?.issues) &&
          error.issues.some((issue) => issue.includes("Missing Lite Discord token")) &&
          error.issues.some((issue) => issue.includes("Missing Lite API write token"))
      );
    }
  );
});
