const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

function resolveProV2LitePipelineScript(rootDir = path.resolve(__dirname, "..")) {
  return path.resolve(rootDir, "..", "pro.v2", "scripts", "lite-pipeline-check.js");
}

function hasFlag(argv, key) {
  return argv.some((arg) => arg === `--${key}` || arg.startsWith(`--${key}=`));
}

function buildStressArgs(argv = []) {
  const nextArgs = Array.isArray(argv) ? [...argv] : [];

  if (!hasFlag(nextArgs, "mode")) {
    nextArgs.push("--mode=stress");
  }

  if (!hasFlag(nextArgs, "guilds")) {
    nextArgs.push("--guilds=1000");
  }

  if (!hasFlag(nextArgs, "events")) {
    nextArgs.push("--events=3");
  }

  if (!hasFlag(nextArgs, "timeoutMs")) {
    nextArgs.push("--timeoutMs=600000");
  }

  return nextArgs;
}

async function runBackendStress(argv = process.argv.slice(2), options = {}) {
  const scriptPath = resolveProV2LitePipelineScript(options.rootDir);

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Lite backend stress script not found at ${scriptPath}`);
  }

  const args = buildStressArgs(argv);
  const child = spawn(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    cwd: path.dirname(scriptPath),
    env: process.env,
  });

  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      if (signal) {
        reject(new Error(`Lite backend stress exited via signal ${signal}`));
        return;
      }

      reject(new Error(`Lite backend stress failed with exit code ${code}`));
    });
  });
}

if (require.main === module) {
  runBackendStress().catch((error) => {
    console.error("[lite.v2] backend stress failed");
    console.error(error?.message || error);
    process.exit(1);
  });
}

module.exports = {
  buildStressArgs,
  resolveProV2LitePipelineScript,
  runBackendStress,
};
