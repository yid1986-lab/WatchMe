const { getWorkerConfig, validateWorkerConfig } = require("./config");
const { startRunner, stopRunner } = require("./runner");
const { startServer, stopServer } = require("./server");

const mode = process.argv.includes("--check") ? "check" : "run";
const config = getWorkerConfig();

if (mode === "check") {
  const { errors } = validateWorkerConfig(config);
  if (errors.length) {
    for (const error of errors) {
      console.error(`[watchme-v2/worker][check] ${error}`);
    }
    process.exit(1);
  }
  console.log(`[watchme-v2/worker][check] config OK for ${config.nodeEnv}`);
  process.exit(0);
}

{
  const { errors } = validateWorkerConfig(config);
  if (errors.length) {
    for (const error of errors) {
      console.error(`[watchme-v2/worker][boot] ${error}`);
    }
    process.exit(1);
  }
}

async function shutdown() {
  stopServer();
  await stopRunner();
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown().catch(() => process.exit(1));
});

process.on("SIGTERM", () => {
  shutdown().catch(() => process.exit(1));
});

console.log(`[watchme-v2/worker] booting ${config.workerName}`);
startServer();
startRunner();
