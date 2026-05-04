const test = require("node:test");
const assert = require("node:assert/strict");

const { buildLitePanelState } = require("../src/panel");
const { buildLitePendingPrompt, buildLiteSubmissionPrompt, formatPromptContent } = require("../src/prompts");
const { validateLiteLaunchReadiness } = require("../src/validation");

test("Lite V2 launch validation passes", () => {
  assert.deepStrictEqual(validateLiteLaunchReadiness(), []);
});

test("Lite prompts render readable copy", () => {
  const submission = buildLiteSubmissionPrompt();
  const pending = buildLitePendingPrompt();

  assert.equal(submission.emoji, "\u{1F4E1}");
  assert.equal(pending.emoji, "\u2705");
  assert.ok(formatPromptContent(submission).startsWith("\u{1F4E1} Add your creator links"));
  assert.ok(formatPromptContent(submission).includes("WatchMe Lite supports up to 5 creators per server."));
  assert.ok(formatPromptContent(pending).startsWith("\u2705 Creator links received"));
  assert.ok(formatPromptContent(pending).includes("waiting to be processed"));
});

test("Lite panel shows a degraded state instead of an empty panel", () => {
  const panel = buildLitePanelState({
    guildId: "guild-1",
    backendStatus: {
      title: "Lite backend unavailable",
      description: "Creator data could not be loaded. Refresh to try again.",
    },
  });

  assert.equal(panel.statusNotice.title, "Lite backend unavailable");
  assert.ok(panel.creatorsText.includes("Refresh to try again"));
  assert.ok(panel.actions.some((action) => action.id === "wme:refresh" && !action.disabled));
  assert.ok(panel.actions.every((action) => action.id === "wme:refresh" || action.disabled));
});
