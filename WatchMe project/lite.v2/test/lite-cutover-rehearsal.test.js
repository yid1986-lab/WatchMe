const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  buildRehearsalStressArgs,
  buildRehearsalSteps,
} = require("../src/cutover-rehearsal");

test("cutover rehearsal defaults to local validation and staged preflight", () => {
  const rootDir = path.resolve(__dirname, "..");
  const steps = buildRehearsalSteps([], { rootDir });

  assert.deepEqual(
    steps.map((step) => step.name),
    ["launch-check", "test-suite", "staged-preflight"]
  );
  assert.equal(steps[2].env.LITE_PREFLIGHT_GUILD_ID, undefined);
  assert.equal(steps.some((step) => step.name === "backend-stress"), false);
});

test("cutover rehearsal can include disposable writes and forwarded stress flags", () => {
  const rootDir = path.resolve(__dirname, "..");
  const steps = buildRehearsalSteps(
    [
      "--guild=staged-guild-1",
      "--with-writes",
      "--with-stress",
      "--stress-guilds=250",
      "--stress-events=1",
      "--stress-timeoutMs=120000",
    ],
    { rootDir }
  );

  assert.deepEqual(
    steps.map((step) => step.name),
    ["launch-check", "test-suite", "staged-preflight", "staged-preflight-write-cycle", "backend-stress"]
  );
  assert.equal(steps[2].env.LITE_PREFLIGHT_GUILD_ID, "staged-guild-1");
  assert.equal(steps[3].env.LITE_PREFLIGHT_ALLOW_WRITES, "1");
  assert.deepEqual(buildRehearsalStressArgs(["--stress-guilds=250", "--stress-events=1"]), [
    "--guilds=250",
    "--events=1",
  ]);
  assert.deepEqual(steps[4].args.slice(1), [
    "--guilds=250",
    "--events=1",
    "--timeoutMs=120000",
  ]);
});
