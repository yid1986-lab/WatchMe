/**
 * Long-run soak: runs API + worker + pager (via run-ops-stack.js) and samples /api/health on an interval.
 *
 * Usage:
 *   npm run soak:stack
 *   npm run soak:stack -- --durationSec=3600
 *   npm run soak:stack -- --healthIntervalSec=30 --durationSec=0
 *
 * --durationSec=0  run until Ctrl+C (default)
 * Stop: Ctrl+C — terminates the stack runner, which SIGTERM’s the three processes.
 */
const { spawn } = require("child_process");
const path = require("path");

function parseArgs(argv) {
  const values = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [rawKey, ...rawValue] = arg.slice(2).split("=");
    values[rawKey] = rawValue.length ? rawValue.join("=") : "true";
  }
  return values;
}

function getApiHealthUrl(args) {
  const explicit =
    args.apiBaseUrl ||
    process.env.SOAK_API_BASE_URL ||
    process.env.API_BASE_URL ||
    process.env.WATCHME_V2_API_BASE_URL;
  if (explicit) {
    return String(explicit).replace(/\/+$/, "") + "/api/health";
  }
  const port = Number(process.env.API_PORT || "3101");
  return `http://127.0.0.1:${port}/api/health`;
}

function getDurationSec(args) {
  const raw = args.durationSec ?? process.env.SOAK_DURATION_SEC;
  if (raw === undefined || raw === "") {
    return 0;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function getHealthIntervalSec(args) {
  const raw = args.healthIntervalSec ?? process.env.SOAK_HEALTH_INTERVAL_SEC ?? "60";
  const n = Number(raw);
  return Math.max(5, Number.isFinite(n) ? Math.floor(n) : 60);
}

async function probeHealth(url) {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const latencyMs = Date.now() - started;
    let bodyOk = null;
    try {
      const data = await res.json();
      bodyOk = data?.ok === true;
    } catch {
      bodyOk = null;
    }
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        event: "soak_health",
        ok: res.ok && bodyOk !== false,
        status: res.status,
        latencyMs,
      })
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        event: "soak_health_error",
        error: error?.name === "AbortError" ? "timeout" : error?.message || String(error),
      })
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, "..");
  const node = process.execPath;
  const stackScript = path.join(__dirname, "run-ops-stack.js");
  const healthUrl = getApiHealthUrl(args);
  const durationSec = getDurationSec(args);
  const healthIntervalSec = getHealthIntervalSec(args);

  const stack = spawn(node, [stackScript], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });

  let finished = false;

  const cleanup = (code = 0) => {
    if (finished) {
      return;
    }
    finished = true;
    if (healthTimer) {
      clearInterval(healthTimer);
    }
    if (durationTimer) {
      clearTimeout(durationTimer);
    }
    if (stack && !stack.killed && stack.exitCode === null) {
      stack.kill("SIGTERM");
    }
    setTimeout(() => process.exit(code), 9000).unref();
  };

  const clearTimers = () => {
    if (healthTimer) {
      clearInterval(healthTimer);
    }
    if (durationTimer) {
      clearTimeout(durationTimer);
    }
  };

  const healthTimer = setInterval(() => {
    probeHealth(healthUrl);
  }, healthIntervalSec * 1000);

  const durationTimer =
    durationSec > 0
      ? setTimeout(() => {
          console.log(
            JSON.stringify({
              at: new Date().toISOString(),
              event: "soak_duration_complete",
              durationSec,
            })
          );
          cleanup(0);
        }, durationSec * 1000)
      : null;

  stack.on("error", (error) => {
    console.error(JSON.stringify({
      at: new Date().toISOString(),
      event: "soak_stack_spawn_error",
      error: error.message,
    }));
    cleanup(1);
  });

  stack.on("exit", (code, signal) => {
    clearTimers();
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        event: "soak_stack_exit",
        code,
        signal: signal || null,
      })
    );
    if (finished) {
      return;
    }
    finished = true;
    process.exit(code === 0 || code === null ? 0 : code);
  });

  process.on("SIGINT", () => {
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        event: "soak_sigint",
      })
    );
    cleanup(0);
  });
  process.on("SIGTERM", () => {
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        event: "soak_sigterm",
      })
    );
    cleanup(0);
  });

  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      event: "soak_start",
      healthUrl,
      healthIntervalSec,
      durationSec: durationSec || null,
      unlimited: durationSec === 0,
    })
  );

  setTimeout(() => probeHealth(healthUrl), 3000);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
