function parseArgs(argv) {
  const values = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [rawKey, ...rawValue] = arg.slice(2).split("=");
    values[rawKey] = rawValue.length ? rawValue.join("=") : "true";
  }
  return values;
}

function getBaseUrl(args) {
  const value =
    args.apiBaseUrl ||
    process.env.API_BASE_URL ||
    process.env.WATCHME_V2_API_BASE_URL ||
    (process.env.API_PORT ? `http://127.0.0.1:${process.env.API_PORT}` : "http://127.0.0.1:3101");

  return String(value).replace(/\/+$/, "");
}

function getIntervalMs(args) {
  const seconds = Number(args.intervalSec || process.env.OPS_PAGER_LOOP_INTERVAL_SECONDS || 60);
  return Math.max(5, Number.isFinite(seconds) ? seconds : 60) * 1000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Chunked sleep so SIGTERM/SIGINT can exit quickly under systemd. */
async function sleepUntilShutdown(ms, isShutdown) {
  const chunk = Math.min(1000, Math.max(1, ms));
  let waited = 0;
  while (waited < ms && !isShutdown()) {
    await sleep(Math.min(chunk, ms - waited));
    waited += Math.min(chunk, ms - waited);
  }
}

async function runSweep(baseUrl, token, dryRun = false) {
  const response = await fetch(`${baseUrl}/api/internal/ops/paging/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-internal-token": token } : {}),
    },
    body: JSON.stringify({
      dry_run: dryRun,
    }),
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(`Pager sweep failed with HTTP ${response.status}: ${text || response.statusText}`);
  }

  return data;
}

function printSummary(result) {
  const actions = Array.isArray(result?.actions) ? result.actions : [];
  const summary = {
    at: new Date().toISOString(),
    skipped: Boolean(result?.skipped),
    currentWarnings: Array.isArray(result?.currentWarnings) ? result.currentWarnings.length : 0,
    actions: actions.length,
    notified: actions.filter((action) => action.deliveryStatus === "sent").length,
    failed: actions.filter((action) => action.deliveryStatus === "failed").length,
  };

  console.log(JSON.stringify(summary));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = getBaseUrl(args);
  const token = process.env.INTERNAL_API_TOKEN || "";
  const dryRun = String(args.dryRun || "false").toLowerCase() === "true";
  const once = String(args.once || "false").toLowerCase() === "true";
  const intervalMs = getIntervalMs(args);

  if (once) {
    const result = await runSweep(baseUrl, token, dryRun);
    printSummary(result);
    return;
  }

  let shutdown = false;
  const onSignal = () => {
    shutdown = true;
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  console.log(JSON.stringify({
    at: new Date().toISOString(),
    event: "pager_loop_start",
    baseUrl,
    intervalSec: intervalMs / 1000,
    dryRun,
  }));

  while (!shutdown) {
    try {
      const result = await runSweep(baseUrl, token, dryRun);
      printSummary(result);
    } catch (error) {
      console.error(JSON.stringify({
        at: new Date().toISOString(),
        error: error?.message || String(error),
      }));
    }

    await sleepUntilShutdown(intervalMs, () => shutdown);
  }

  console.log(JSON.stringify({
    at: new Date().toISOString(),
    event: "pager_loop_stop",
    reason: "signal",
  }));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
