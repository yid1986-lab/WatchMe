function liteIntroCopy() {
  return {
    title: "Add your creator links",
    body: "Add your Twitch or YouTube link to join this server's WatchMe Lite creator list. Someone with Manage Server will review it before alerts go live.",
    footer: "WatchMe Lite supports up to 5 creators per server.",
  };
}

function liteSupportedPlatformsCopy() {
  return {
    title: "Supported on Lite",
    items: ["Twitch", "YouTube"],
    note: "Kick is not included in Lite.",
  };
}

function litePendingApprovalCopy() {
  return {
    title: "Creator links received",
    body: "Your creator details were saved and are waiting to be processed. WatchMe will start posting alerts once Lite finishes syncing the creator.",
    footer: "You can update your links later if needed.",
  };
}

function liteSubmissionFailureCopy() {
  return {
    title: "Could not save creator link",
    body: "Please check the link and try again in a moment.",
    footer: "If the issue keeps happening, refresh the panel and retry.",
  };
}

function liteLimitReachedCopy(limit, upgradeUrl) {
  return {
    title: "Lite creator limit reached",
    body: `This server already has ${limit} creators on WatchMe Lite. Upgrade to Pro to add more creators and unlock advanced setup tools.`,
    footer: "Upgrade to Pro from the WatchMe website.",
    ctaLabel: "Upgrade to Pro",
    ctaUrl: upgradeUrl,
  };
}

function liteInvalidSubmissionCopy() {
  return {
    title: "Add at least one link",
    body: "Please include a Twitch or YouTube link to continue.",
    footer: "Lite only supports Twitch and YouTube.",
  };
}

module.exports = {
  liteIntroCopy,
  liteInvalidSubmissionCopy,
  liteLimitReachedCopy,
  litePendingApprovalCopy,
  liteSubmissionFailureCopy,
  liteSupportedPlatformsCopy,
};
