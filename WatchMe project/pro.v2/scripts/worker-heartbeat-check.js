const http = require("node:http");
const { Pool } = require("pg");

const { createServer } = require("../apps/api/src/server");
const apiDb = require("../apps/api/src/db");
const workerDb = require("../apps/worker/src/db");
const { startRunner, stopRunner } = require("../apps/worker/src/runner");
const { upsertWorkerHeartbeat } = require("../apps/worker/src/store");

const DEFAULT_DATABASE_URL = "postgres://watchme:watchme@127.0.0.1:5432/watchme_v2";

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

async function waitFor(check, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${label}`);
}

async function seedWorkerStartEvent(workerName, startedAt) {
  await upsertWorkerHeartbeat(
    {
      workerName,
      nodeEnv: process.env.NODE_ENV,
      queues: ["platform_ingest"],
      startedAt,
      process: {
        pid: process.pid,
        uptimeSeconds: 1,
        rssBytes: 1024,
        heapUsedBytes: 1024,
        heapTotalBytes: 1024,
        externalBytes: 0,
        arrayBuffersBytes: 0,
        maxRssBytes: 1024,
        maxHeapUsedBytes: 1024,
        sampleCount: 1,
      },
    },
    {
      status: "running",
    }
  );
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  });

  const originalEnv = {
    API_PORT: process.env.API_PORT,
    INTERNAL_API_TOKEN: process.env.INTERNAL_API_TOKEN,
    NODE_ENV: process.env.NODE_ENV,
    WORKER_NAME: process.env.WORKER_NAME,
    WORKER_POLL_INTERVAL_MS: process.env.WORKER_POLL_INTERVAL_MS,
    WORKER_HEARTBEAT_INTERVAL_MS: process.env.WORKER_HEARTBEAT_INTERVAL_MS,
    OPS_WORKER_HEARTBEAT_WARNING_SECONDS: process.env.OPS_WORKER_HEARTBEAT_WARNING_SECONDS,
    OPS_WORKER_RSS_WARNING_BYTES: process.env.OPS_WORKER_RSS_WARNING_BYTES,
    OPS_WORKER_HEAP_WARNING_BYTES: process.env.OPS_WORKER_HEAP_WARNING_BYTES,
    OPS_WORKER_RESTART_STORM_WINDOW_SECONDS: process.env.OPS_WORKER_RESTART_STORM_WINDOW_SECONDS,
    OPS_WORKER_RESTART_STORM_MIN_COUNT: process.env.OPS_WORKER_RESTART_STORM_MIN_COUNT,
  };

  const internalToken = "worker-heartbeat-check-token";
  const workerName = `watchme-v2-heartbeat-smoke-${Date.now()}`;
  let apiServer = null;

  try {
    process.env.NODE_ENV = "development";
    process.env.INTERNAL_API_TOKEN = internalToken;
    process.env.WORKER_NAME = workerName;
    process.env.WORKER_POLL_INTERVAL_MS = "750";
    process.env.WORKER_HEARTBEAT_INTERVAL_MS = "500";
    process.env.OPS_WORKER_HEARTBEAT_WARNING_SECONDS = "2";
    process.env.OPS_WORKER_RSS_WARNING_BYTES = "1024";
    process.env.OPS_WORKER_HEAP_WARNING_BYTES = "1024";
    process.env.OPS_WORKER_RESTART_STORM_WINDOW_SECONDS = "30";
    process.env.OPS_WORKER_RESTART_STORM_MIN_COUNT = "3";

    await pool.query(`DELETE FROM worker_heartbeats WHERE worker_name = $1`, [workerName]).catch(() => {});
    await pool.query(`DELETE FROM worker_start_events WHERE worker_name = $1`, [workerName]).catch(() => {});

    apiServer = createServer();
    const apiAddress = await listen(apiServer);

    startRunner();

    let healthyOps = null;
    await waitFor(async () => {
      const response = await requestJson(apiAddress.port, "/api/internal/ops/health", {
        token: internalToken,
      });
      healthyOps = response;
      return Number(response?.summary?.workers?.running || 0) >= 1;
    }, 8000, "worker heartbeat to appear");

    const healthyWarningCodes = (healthyOps.warnings || []).map((warning) => warning.code);
    if (healthyWarningCodes.includes("worker_heartbeat_stale") || healthyWarningCodes.includes("worker_heartbeat_missing")) {
      throw new Error("Did not expect stale or missing worker warnings while the runner heartbeat is active.");
    }

    if (healthyWarningCodes.includes("worker_restart_storm")) {
      throw new Error("Did not expect worker_restart_storm before repeated start events were recorded.");
    }

    if (!healthyWarningCodes.includes("worker_memory_rss_high")) {
      throw new Error("Expected low RSS threshold to trigger worker_memory_rss_high.");
    }

    if (!healthyWarningCodes.includes("worker_memory_heap_high")) {
      throw new Error("Expected low heap threshold to trigger worker_memory_heap_high.");
    }

    await stopRunner();

    const now = Date.now();
    for (const offsetMs of [20000, 12000, 4000]) {
      await seedWorkerStartEvent(workerName, new Date(now - offsetMs).toISOString());
    }

    const stormOps = await requestJson(apiAddress.port, "/api/internal/ops/health", {
      token: internalToken,
    });
    const stormWarningCodes = (stormOps.warnings || []).map((warning) => warning.code);

    if (!stormWarningCodes.includes("worker_restart_storm")) {
      throw new Error(`Expected worker_restart_storm, found ${stormWarningCodes.join(", ")}`);
    }

    await pool.query(
      `
        UPDATE worker_heartbeats
        SET
          status = 'running',
          last_seen_at = NOW() - INTERVAL '10 seconds',
          updated_at = NOW() - INTERVAL '10 seconds'
        WHERE worker_name = $1
      `,
      [workerName]
    );

    const staleOps = await requestJson(apiAddress.port, "/api/internal/ops/health", {
      token: internalToken,
    });
    const staleWarningCodes = (staleOps.warnings || []).map((warning) => warning.code);

    if (!staleWarningCodes.includes("worker_heartbeat_stale")) {
      throw new Error(`Expected worker_heartbeat_stale, found ${staleWarningCodes.join(", ")}`);
    }

    console.log(JSON.stringify({
      ok: true,
      workerName,
      healthyWorkers: healthyOps.summary.workers,
      healthyWarningCodes,
      stormWorkers: stormOps.summary.workers,
      stormWarningCodes,
      staleWorkers: staleOps.summary.workers,
      staleWarningCodes,
      recentWorkers: staleOps.recentWorkers,
    }, null, 2));
  } finally {
    await stopRunner().catch(() => {});

    if (apiServer) {
      await new Promise((resolve) => apiServer.close(resolve));
    }

    await pool.query(`DELETE FROM worker_heartbeats WHERE worker_name = $1`, [workerName]).catch(() => {});
    await pool.query(`DELETE FROM worker_start_events WHERE worker_name = $1`, [workerName]).catch(() => {});
    await pool.end();
    await apiDb.closePool().catch(() => {});
    await workerDb.closePool().catch(() => {});

    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }
}

main().catch((error) => {
  console.error("FAIL worker heartbeat smoke");
  console.error(error?.stack || error);
  process.exit(1);
});
