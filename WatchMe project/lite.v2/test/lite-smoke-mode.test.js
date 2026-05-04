const test = require("node:test");
const assert = require("node:assert/strict");

const { runLiteSmoke } = require("../src/smoke");

test("Lite smoke mode runs without a backend", async () => {
  const result = await runLiteSmoke({ guildId: "guild-smoke", useBackend: false });

  assert.equal(result.mode, "offline");
  assert.equal(result.commandName, "wme");
  assert.equal(result.creatorLimit, 5);
  assert.deepStrictEqual(result.supportedPlatforms, ["twitch", "youtube"]);
  assert.equal(result.panelTitle, "WatchMe Lite Control Panel");
  assert.equal(result.backend, null);
});
