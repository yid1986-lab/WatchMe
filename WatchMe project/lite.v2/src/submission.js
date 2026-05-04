const { PLAN_LIMITS } = require("./plan-limits");
const {
  buildLiteInvalidSubmissionPrompt,
  buildLiteLimitPrompt,
  buildLitePendingPrompt,
  buildLiteSubmissionPrompt,
} = require("./prompts");

function getLiteSupportedPlatforms() {
  return PLAN_LIMITS.lite.supportedPlatforms.slice();
}

function buildLiteSubmissionFlow() {
  return {
    entryPrompt: buildLiteSubmissionPrompt(),
    supportedPlatforms: getLiteSupportedPlatforms(),
    creatorLimit: PLAN_LIMITS.lite.maxCreatorsPerGuild,
    steps: [
      "Open WatchMe Lite in Discord",
      "Choose Twitch or YouTube",
      "Add the creator link",
    ],
  };
}

function buildLiteSubmissionResult(result) {
  if (result?.code === "INVALID_SUBMISSION") {
    return buildLiteInvalidSubmissionPrompt();
  }

  if (result?.code === "LITE_CREATOR_LIMIT_REACHED") {
    return buildLiteLimitPrompt(result.capacity);
  }

  return buildLitePendingPrompt();
}

module.exports = {
  buildLiteSubmissionFlow,
  buildLiteSubmissionResult,
  getLiteSupportedPlatforms,
};
