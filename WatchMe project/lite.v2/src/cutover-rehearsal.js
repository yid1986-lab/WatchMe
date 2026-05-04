const { spawn } = require("node:child_process");
const path = require("node:path");

function hasFlag(argv, key) {
  return argv.some((arg) => arg === `--${key}` || arg.startsWith(`--${key}=`));
}

function getFlagValue(argv, key) {
  const prefix = `--${key}=`;
  const valueArg = argv.find((arg) => arg.startsWith(prefix));
  return valueArg ? valueArg.slice(prefix.length) : "";
}

function buildPrefightEnv(argv = [], extraEnv = {}) {
  const env = { ...extraEnv };
  const guildId = getFlagValue(argv, "guild");
  if (guildId) {
    env.LITE_PREFLIGHT_GUILD_ID = guildId;
  }
  return env;
}

function buildRehearsalStressArgs(argv = []) {
  return argv
    .filter((arg) => arg.startsWith("--stress-"))
    .map((arg) => `--${arg.slice("--stress-".length)}`);
}

function buildRehearsalSteps(argv = [], options = {}) {
  const rootDir = path.resolve(options.rootDir || path.resolve(__dirname, ".."));
  const runWrites = hasFlag(argv, "with-writes") || process.env.LITE_REHEARSAL_ALLOW_WRITES === "1";
  const runStress = hasFlag(argv, "with-stress") || process.env.LITE_REHEARSAL_RUN_STRESS === "1";
  const preflightEnv = buildPrefightEnv(argv);
  const steps = [
    {
      name: "launch-check",
      command: process.execPath,
      args: [path.resolve(rootDir, "src", "index.js"), "--check"],
      cwd: rootDir,
      env: {},
    },
    {
      name: "test-suite",
      command: process.execPath,
      args: ["--test"],
      cwd: rootDir,
      env: {},
    },
    {
      name: "staged-preflight",
      command: process.execPath,
      args: [path.resolve(rootDir, "src", "index.js"), "--preflight"],
      cwd: rootDir,
      env: preflightEnv,
    },
  ];

  if (runWrites) {
    steps.push({
      name: "staged-preflight-write-cycle",
      command: process.execPath,
      args: [path.resolve(rootDir, "src", "index.js"), "--preflight"],
      cwd: rootDir,
      env: {
        ...preflightEnv,
        LITE_PREFLIGHT_ALLOW_WRITES: "1",
      },
    });
  }

  if (runStress) {
    steps.push({
      name: "backend-stress",
      command: process.execPath,
      args: [path.resolve(rootDir, "src", "backend-stress.js"), ...buildRehearsalStressArgs(argv)],
      cwd: rootDir,
      env: {},
    });
  }

  return steps;
}

function runStep(step) {
  const startedAt = Date.now();
  console.log(`[lite.v2] running ${step.name}`);

  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      stdio: "inherit",
      cwd: step.cwd,
      env: {
        ...process.env,
        ...(step.env || {}),
      },
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve({
          name: step.name,
          elapsedMs: Date.now() - startedAt,
        });
        return;
      }

      if (signal) {
        reject(new Error(`${step.name} exited via signal ${signal}`));
        return;
      }

      reject(new Error(`${step.name} failed with exit code ${code}`));
    });
  });
}

async function runLiteCutoverRehearsal(argv = process.argv.slice(2), options = {}) {
  const steps = buildRehearsalSteps(argv, options);
  const results = [];

  for (const step of steps) {
    results.push(await runStep(step));
  }

  return {
    ok: true,
    steps: results,
  };
}

if (require.main === module) {
  runLiteCutoverRehearsal().then(
    (result) => {
      console.log("[lite.v2] cutover rehearsal passed");
      for (const step of result.steps) {
        console.log(`[lite.v2] ${step.name}: ${step.elapsedMs}ms`);
      }
    },
    (error) => {
      console.error("[lite.v2] cutover rehearsal failed");
      console.error(error?.message || error);
      process.exit(1);
    }
  );
}

module.exports = {
  buildRehearsalStressArgs,
  buildRehearsalSteps,
  runLiteCutoverRehearsal,
};
