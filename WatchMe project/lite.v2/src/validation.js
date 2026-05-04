const { getSlashCommands } = require("./discord-runtime");
const { buildLitePanelState } = require("./panel");
const {
  buildLiteInvalidSubmissionPrompt,
  buildLiteLimitPrompt,
  buildLitePendingPrompt,
  buildLiteSubmissionFailurePrompt,
  buildLiteSubmissionPrompt,
  formatPromptContent,
} = require("./prompts");

const MOJIBAKE_PATTERN = /(?:\u00C3[\u0080-\u00BF]|\u00C2[\u0080-\u00BF]|\u00E2[\u0080-\u00BF]{1,2}|\u00F0[\u0080-\u00BF]{1,3}|\uFFFD)/;

function collectStrings(value, path = "value", results = []) {
  if (typeof value === "string") {
    results.push({ path, value });
    return results;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, results));
    return results;
  }

  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      collectStrings(entry, `${path}.${key}`, results);
    }
  }

  return results;
}

function validatePrompt(prompt, label, issues) {
  for (const { path, value } of collectStrings(prompt, label)) {
    if (MOJIBAKE_PATTERN.test(value)) {
      issues.push(`${label} contains mojibake at ${path}: ${JSON.stringify(value)}`);
    }
  }
}

function validateLiteLaunchReadiness() {
  const issues = [];

  const submissionPrompt = buildLiteSubmissionPrompt();
  const pendingPrompt = buildLitePendingPrompt();
  const limitPrompt = buildLiteLimitPrompt({
    creatorLimit: 5,
    upgradeUrl: "https://pro.watchme-bot.com/login",
  });
  const invalidPrompt = buildLiteInvalidSubmissionPrompt();
  const failurePrompt = buildLiteSubmissionFailurePrompt();

  [submissionPrompt, pendingPrompt, limitPrompt, invalidPrompt, failurePrompt].forEach((prompt, index) =>
    validatePrompt(prompt, `prompt[${index}]`, issues)
  );

  const formattedSubmissionPrompt = formatPromptContent(submissionPrompt);
  if (!formattedSubmissionPrompt.startsWith("\u{1F4E1} Add your creator links")) {
    issues.push("formatted submission prompt is missing the expected emoji heading");
  }
  if (!formattedSubmissionPrompt.includes("WatchMe Lite supports up to 5 creators per server.")) {
    issues.push("formatted submission prompt is missing the Lite creator cap copy");
  }
  if (!formattedSubmissionPrompt.includes("Kick is not included in Lite.")) {
    issues.push("formatted submission prompt is missing the supported-platform note");
  }

  const formattedPendingPrompt = formatPromptContent(pendingPrompt);
  if (!formattedPendingPrompt.startsWith("\u2705 Creator links received")) {
    issues.push("formatted pending prompt is missing the expected emoji heading");
  }
  if (!formattedPendingPrompt.includes("waiting to be processed")) {
    issues.push("formatted pending prompt is missing the processing-state copy");
  }

  const formattedLimitPrompt = formatPromptContent(limitPrompt);
  if (!formattedLimitPrompt.startsWith("\u{1F680} Lite creator limit reached")) {
    issues.push("formatted limit prompt is missing the expected emoji heading");
  }
  if (!formattedLimitPrompt.includes("[Upgrade to Pro](https://pro.watchme-bot.com/login)")) {
    issues.push("formatted limit prompt is missing the upgrade CTA");
  }

  const formattedInvalidPrompt = formatPromptContent(invalidPrompt);
  if (!formattedInvalidPrompt.startsWith("\u26A0\uFE0F Add at least one link")) {
    issues.push("formatted invalid prompt is missing the expected emoji heading");
  }
  if (!formattedInvalidPrompt.includes("Please include a Twitch or YouTube link to continue.")) {
    issues.push("formatted invalid prompt is missing the validation guidance");
  }

  const formattedFailurePrompt = formatPromptContent(failurePrompt);
  if (!formattedFailurePrompt.startsWith("\u26A0\uFE0F Could not save creator link")) {
    issues.push("formatted failure prompt is missing the expected emoji heading");
  }
  if (!formattedFailurePrompt.includes("refresh the panel and retry")) {
    issues.push("formatted failure prompt is missing the recovery guidance");
  }

  const healthyPanel = buildLitePanelState({
    guildId: "test-guild",
    alertChannelId: "123",
    creators: [{ displayName: "Example Creator", url: "https://twitch.tv/example" }],
  });

  if (healthyPanel.statusNotice) {
    issues.push("healthy panel should not include a backend status notice");
  }
  if (healthyPanel.supportedPlatformsText !== "Twitch + YouTube") {
    issues.push("healthy panel should show title-cased platform names");
  }

  const degradedPanel = buildLitePanelState({
    guildId: "test-guild",
    backendStatus: {
      title: "Lite backend unavailable",
      description: "Creator data could not be loaded. Refresh to try again.",
    },
  });

  if (!degradedPanel.statusNotice) {
    issues.push("degraded panel should include a backend status notice");
  }

  if (degradedPanel.creatorsText === "No creators saved.") {
    issues.push("degraded panel should not render as an empty creators list");
  }
  if (healthyPanel.upgradePrompt) {
    issues.push("healthy panel should not show an upgrade prompt");
  }

  const fullPanel = buildLitePanelState({
    guildId: "test-guild",
    creators: [
      { displayName: "Creator 1", url: "https://twitch.tv/creator1" },
      { displayName: "Creator 2", url: "https://youtube.com/@creator2" },
      { displayName: "Creator 3", url: "https://twitch.tv/creator3" },
      { displayName: "Creator 4", url: "https://youtube.com/@creator4" },
      { displayName: "Creator 5", url: "https://twitch.tv/creator5" },
    ],
  });

  if (!fullPanel.upgradePrompt || !fullPanel.upgradePrompt.description.includes("Upgrade to Pro")) {
    issues.push("full panel should show the Pro upgrade prompt at the Lite cap");
  }

  const refreshAction = degradedPanel.actions.find((action) => action.id === "wme:refresh");
  const blockedActions = degradedPanel.actions.filter((action) => action.id !== "wme:refresh");
  if (!refreshAction || refreshAction.disabled) {
    issues.push("degraded panel should keep refresh enabled");
  }
  if (blockedActions.some((action) => !action.disabled)) {
    issues.push("degraded panel should disable non-refresh actions");
  }

  const commands = getSlashCommands();
  if (commands.length !== 1 || commands[0]?.name !== "wme") {
    issues.push("slash command validation failed");
  }

  const { buildLiteSubmissionFlow } = require("./submission");
  const submissionFlow = buildLiteSubmissionFlow();
  if (submissionFlow.creatorLimit !== 5) {
    issues.push("submission flow validation failed");
  }
  if (submissionFlow.supportedPlatforms.join(", ") !== "twitch, youtube") {
    issues.push("submission flow should preserve the backend platform contract");
  }

  return issues;
}

module.exports = {
  validateLiteLaunchReadiness,
};
