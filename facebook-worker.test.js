const http = require("node:http");
const { Pool } = require("pg");

const { createServer } = require("../apps/api/src/server");
const apiDb = require("../apps/api/src/db");

const DEFAULT_DATABASE_URL = "postgres://watchme:watchme@127.0.0.1:5432/watchme_v2";
const INCIDENT_CODE = "pager_smoke_social_feed_failed_posts";

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address()));
  });
}

function readJsonResponse(response) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
      }

      if (response.statusCode >= 400) {
        reject(new Error(`HTTP ${response.statusCode}: ${text}`));
        return;
      }

      resolve(data);
    });
  });
}

function requestJson(port, path, { method = "GET", body = null, token = null } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { "x-internal-token": token } : {}),
        },
      },
      (response) => {
        readJsonResponse(response).then(resolve).catch(reject);
      }
    );

    request.once("error", reject);
    if (body) {
      request.write(JSON.stringify(body));
    }
    request.end();
  });
}

function startPagerWebhookStub(port, state) {
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/pager") {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }

      const payload = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
        : {};
      state.messages.push(payload);

      const body = JSON.stringify({
        ok: true,
        received: state.messages.length,
      });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return listen(server, port).then(() => server);
}

async function cleanupPagerSmokeRows(pool) {
  await pool.query(
    `
      DELETE FROM ops_pager_deliveries
      WHERE incident_code = $1
    `,
    [INCIDENT_CODE]
  ).catch(() => {});

  await pool.query(
    `
      DELETE FROM ops_pager_incidents
      WHERE incident_code = $1
    `,
    [INCIDENT_CODE]
  ).catch(() => {});
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  });

  const originalInternalToken = process.env.INTERNAL_API_TOKEN;
  const originalPagerWebhook = process.env.OPS_PAGER_DISCORD_WEBHOOK_URL;
  const originalPagerMinSeverity = process.env.OPS_PAGER_MIN_SEVERITY;
  const originalPagerCooldown = process.env.OPS_PAGER_COOLDOWN_SECONDS;
  const originalPagerReminder = process.env.OPS_PAGER_REMINDER_SECONDS;
  const originalPagerService = process.env.OPS_PAGER_SERVICE_NAME;
  const originalNodeEnv = process.env.NODE_ENV;
  const internalToken = "pager-check-token";
  const pagerState = { messages: [] };
  let apiServer = null;
  let pagerServer = null;

  try {
    process.env.INTERNAL_API_TOKEN = internalToken;
    process.env.NODE_ENV = "development";
    process.env.OPS_PAGER_MIN_SEVERITY = "high";
    process.env.OPS_PAGER_COOLDOWN_SECONDS = "900";
    process.env.OPS_PAGER_REMINDER_SECONDS = "3600";
    process.env.OPS_PAGER_SERVICE_NAME = "WatchMe V2";

    pagerServer = await startPagerWebhookStub(39471, pagerState);
    process.env.OPS_PAGER_DISCORD_WEBHOOK_URL = "http://127.0.0.1:39471/pager";

    await cleanupPagerSmokeRows(pool);

    apiServer = createServer();
    const apiAddress = await listen(apiServer);

    const firstRun = await requestJson(apiAddress.port, "/api/internal/ops/paging/run", {
      method: "POST",
      token: internalToken,
      body: {
        warning_overrides: [
          {
            code: INCIDENT_CODE,
            severity: "high",
            count: 3,
            message: "3 socials-feed posts are failing in the pager smoke.",
          },
        ],
      },
    });

    if (!Array.isArray(firstRun.actions) || firstRun.actions.length !== 1) {
      throw new Error("Expected exactly one pager action on the first run.");
    }

    if (firstRun.actions[0].eventType !== "page") {
      throw new Error(`Expected first pager action to be page, found ${firstRun.actions[0].eventType}`);
    }

    if (firstRun.actions[0].deliveryStatus !== "sent") {
      throw new Error(`Expected first pager delivery sent, found ${firstRun.actions[0].deliveryStatus}`);
    }

    if (pagerState.messages.length !== 1) {
      throw new Error(`Expected 1 pager webhook message after first run, found ${pagerState.messages.length}`);
    }

    const secondRun = await requestJson(apiAddress.port, "/api/internal/ops/paging/run", {
      method: "POST",
      token: internalToken,
      body: {
        warning_overrides: [
          {
            code: INCIDENT_CODE,
            severity: "high",
            count: 3,
            message: "3 socials-feed posts are failing in the pager smoke.",
          },
        ],
      },
    });

    if (secondRun.actions[0].eventType !== "observe") {
      throw new Error(`Expected second pager action to be observe, found ${secondRun.actions[0].eventType}`);
    }

    if (pagerState.messages.length !== 1) {
      throw new Error(`Expected cooldown to suppress the second pager send, found ${pagerState.messages.length} messages`);
    }

    const resolveRun = await requestJson(apiAddress.port, "/api/internal/ops/paging/run", {
      method: "POST",
      token: internalToken,
      body: {
        warning_overrides: [],
      },
    });

    if (resolveRun.actions.length !== 1 || resolveRun.actions[0].eventType !== "resolve") {
      throw new Error("Expected one resolve pager action when override warnings clear.");
    }

    if (resolveRun.actions[0].deliveryStatus !== "sent") {
      throw new Error(`Expected resolve pager delivery sent, found ${resolveRun.actions[0].deliveryStatus}`);
    }

    if (pagerState.messages.length !== 2) {
      throw new Error(`Expected 2 pager webhook messages after recovery, found ${pagerState.messages.length}`);
    }

    const pagerStatus = await requestJson(apiAddress.port, "/api/internal/ops/paging", {
      method: "GET",
      token: internalToken,
    });
    const smokeIncident = (pagerStatus.incidents || []).find((incident) => incident.incident_code === INCIDENT_CODE);
    const smokeDeliveries = (pagerStatus.recentDeliveries || []).filter((delivery) => delivery.incident_code === INCIDENT_CODE);

    if (!smokeIncident || smokeIncident.status !== "resolved") {
      throw new Error("Expected pager status to show the smoke incident as resolved.");
    }

    if (smokeDeliveries.length < 2) {
      throw new Error(`Expected at least 2 pager deliveries for the smoke incident, found ${smokeDeliveries.length}`);
    }

    console.log(JSON.stringify({
      ok: true,
      incidentCode: INCIDENT_CODE,
      firstRunAction: firstRun.actions[0],
      secondRunAction: secondRun.actions[0],
      resolveRunAction: resolveRun.actions[0],
      pagerWebhookMessages: pagerState.messages,
      pagerIncident: smokeIncident,
      pagerDeliveries: smokeDeliveries,
    }, null, 2));
  } finally {
    if (apiServer) {
      await new Promise((resolve) => apiServer.close(resolve));
    }
    if (pagerServer) {
      await new Promise((resolve) => pagerServer.close(resolve));
    }

    await cleanupPagerSmokeRows(pool);
    await pool.end();
    await apiDb.closePool().catch(() => {});

    process.env.INTERNAL_API_TOKEN = originalInternalToken;
    process.env.OPS_PAGER_DISCORD_WEBHOOK_URL = originalPagerWebhook;
    process.env.OPS_PAGER_MIN_SEVERITY = originalPagerMinSeverity;
    process.env.OPS_PAGER_COOLDOWN_SECONDS = originalPagerCooldown;
    process.env.OPS_PAGER_REMINDER_SECONDS = originalPagerReminder;
    process.env.OPS_PAGER_SERVICE_NAME = originalPagerService;
    process.env.NODE_ENV = originalNodeEnv;
  }
}

main().catch((error) => {
  console.error("FAIL paging smoke");
  console.error(error?.stack || error);
  process.exit(1);
});
