const { closePool } = require("./db");
const { getApiConfig, validateApiConfig } = require("./config");
const { createServer } = require("./server");

const mode = process.argv.includes("--check") ? "check" : "run";
const config = getApiConfig();

if (mode === "check") {
  const { errors } = validateApiConfig(config);
  if (errors.length) {
    for (const error of errors) {
      console.error(`[watchme-v2/api][check] ${error}`);
    }
    process.exit(1);
  }
  console.log(`[watchme-v2/api][check] config OK for ${config.nodeEnv}`);
  process.exit(0);
}

{
  const { errors } = validateApiConfig(config);
  if (errors.length) {
    for (const error of errors) {
      console.error(`[watchme-v2/api][boot] ${error}`);
    }
    process.exit(1);
  }
}

const server = createServer();

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`[watchme-v2/api] shutdown (${signal})`);
  await new Promise((resolve) => {
    server.close((err) => {
      if (err) {
        console.error(`[watchme-v2/api] server.close: ${err.message}`);
      }
      resolve();
    });
  });
  try {
    await closePool();
  } catch (error) {
    console.error(`[watchme-v2/api] closePool: ${error?.message || error}`);
  }
  process.exit(0);
}

server.listen(config.port, () => {
  console.log(`[watchme-v2/api] listening on ${config.port} (${config.nodeEnv})`);
});

process.on("SIGINT", () => shutdown("SIGINT").catch(() => process.exit(1)));
process.on("SIGTERM", () => shutdown("SIGTERM").catch(() => process.exit(1)));
