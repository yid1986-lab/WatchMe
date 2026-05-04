const {
  liteIntroCopy,
  liteInvalidSubmissionCopy,
  liteLimitReachedCopy,
  litePendingApprovalCopy,
  liteSubmissionFailureCopy,
  liteSupportedPlatformsCopy,
} = require("./copy");

function formatPromptContent(prompt) {
  const lines = [prompt.emoji ? `${prompt.emoji} ${prompt.title}` : prompt.title, prompt.description];

  if (prompt.ctaLabel && prompt.ctaUrl) {
    lines.push(`[${prompt.ctaLabel}](${prompt.ctaUrl})`);
  }

  if (prompt.note) {
    lines.push(prompt.note);
  }

  return lines.filter(Boolean).join("\n");
}

function buildLiteSubmissionPrompt() {
  const copy = liteIntroCopy();
  const supported = liteSupportedPlatformsCopy();

  return {
    title: copy.title,
    description: copy.body,
    supportedTitle: supported.title,
    supportedItems: supported.items,
    note: `${copy.footer} ${supported.note}`,
    emoji: "\u{1F4E1}",
  };
}

function buildLiteLimitPrompt(capacity) {
  const copy = liteLimitReachedCopy(capacity.creatorLimit, capacity.upgradeUrl);

  return {
    title: copy.title,
    description: copy.body,
    emoji: "\u{1F680}",
    upgradeUrl: copy.ctaUrl,
    ctaUrl: copy.ctaUrl,
    ctaLabel: copy.ctaLabel,
    note: copy.footer,
  };
}

function buildLitePendingPrompt() {
  const copy = litePendingApprovalCopy();

  return {
    title: copy.title,
    description: copy.body,
    emoji: "\u2705",
    note: copy.footer,
  };
}

function buildLiteInvalidSubmissionPrompt() {
  const copy = liteInvalidSubmissionCopy();

  return {
    title: copy.title,
    description: copy.body,
    emoji: "\u26A0\uFE0F",
    note: copy.footer,
  };
}

function buildLiteSubmissionFailurePrompt() {
  const copy = liteSubmissionFailureCopy();

  return {
    title: copy.title,
    description: copy.body,
    emoji: "\u26A0\uFE0F",
    note: copy.footer,
  };
}

module.exports = {
  buildLiteInvalidSubmissionPrompt,
  buildLiteLimitPrompt,
  buildLitePendingPrompt,
  buildLiteSubmissionFailurePrompt,
  buildLiteSubmissionPrompt,
  formatPromptContent,
};
