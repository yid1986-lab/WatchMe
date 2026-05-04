const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  buildStressArgs,
  resolveProV2LitePipelineScript,
} = require("../src/backend-stress");

test("backend stress defaults target the proven Lite-through-V2 stress shape", () => {
  const args = buildStressArgs([]);

  assert.deepEqual(args, [
    "--mode=stress",
    "--guilds=1000",
    "--events=3",
    "--timeoutMs=600000",
  ]);
});

test("backend stress preserves explicit caller overrides", () => {
  const args = buildStressArgs([
    "--guilds=250",
    "--events=1",
    "--timeoutMs=120000",
    "--mode=batch",
  ]);

  assert.deepEqual(args, [
    "--guilds=250",
    "--events=1",
    "--timeoutMs=120000",
    "--mode=batch",
  ]);
});

test("backend stress resolves the shared pro.v2 Lite pipeline script", () => {
  const scriptPath = resolveProV2LitePipelineScript(path.resolve(__dirname, ".."));

  assert.ok(scriptPath.endsWith(path.join("pro.v2", "scripts", "lite-pipeline-check.js")));
});
