const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

function createCliPreflightServer() {
  const state = {
    guildConfig: {
      guild_id: "cutover-check-guild",
      announce_channel_id: "",
    },
    creators: [],
  };

  const server = http.createServer((req, res) => {
    const { method, url } = req;

    if (method === "GET" && url === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "watchme-v2-api" }));
      return;
    }

    if (method === "GET" && url === "/api/guilds/cutover-check-guild/config") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(state.guildConfig));
      return;
    }

    if (method === "GET" && url === "/api/lite/guilds/cutover-check-guild/capacity") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ creatorCount: 0, remaining: 5, isFull: false }));
      return;
    }

    if (method === "GET" && url === "/api/lite/guilds/cutover-check-guild/creators") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ creators: state.creators, capacity: { creatorCount: 0, remaining: 5, isFull: false } }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return server;
}

function runLiteCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(__dirname, "..", "src", "index.js"), ...args], {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test("CLI preflight exits cleanly after a successful staged check", async () => {
  const server = createCliPreflightServer();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const result = await runLiteCli(["--preflight"], {
      LITE_DISCORD_TOKEN: "lite-v2-token",
      LITE_API_WRITE_TOKEN: "lite-v2-write-token",
      LITE_API_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    });

    assert.equal(result.signal, null);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /cutover preflight passed/);
    assert.equal(result.stderr.trim(), "");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
