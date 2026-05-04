import assert from "node:assert/strict";

import { buildDiscordAuthorizeUrl, resolveDiscordRedirectUri } from "../apps/api/src/discord-oauth.js";
import { resolveEntitlement } from "../apps/api/src/entitlement-service.js";

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

runTest("Pending billing stays Lite", () => {
  const result = resolveEntitlement({ billingStatus: "APPROVAL_PENDING" });
  assert.equal(result.active, false);
  assert.equal(result.tier, "lite");
  assert.equal(result.reason, "pending-does-not-unlock-pro");
});

runTest("Active billing unlocks Pro", () => {
  const result = resolveEntitlement({ billingStatus: "ACTIVE" });
  assert.equal(result.active, true);
  assert.equal(result.tier, "pro");
});

runTest("Tester access can unlock Pro without billing", () => {
  const result = resolveEntitlement({ tester: true });
  assert.equal(result.active, true);
  assert.equal(result.source, "tester");
});

runTest("Discord OAuth redirect stays on approved host", () => {
  const result = resolveDiscordRedirectUri({
    forwardedHost: "watchme-bot.com",
    forwardedProto: "https",
    hostHeader: "watchme-bot.com",
    redirectUriFallback: "https://watchme-bot.com/auth/discord/callback",
    extraHosts: [],
  });
  assert.equal(result, "https://watchme-bot.com/auth/discord/callback");
});

runTest("Discord authorize URL includes client, redirect, and state", () => {
  const result = buildDiscordAuthorizeUrl({
    clientId: "123",
    redirectUri: "https://watchme-bot.com/auth/discord/callback",
    oauthState: "state-abc",
  });

  assert.match(result, /client_id=123/);
  assert.match(result, /redirect_uri=https%3A%2F%2Fwatchme-bot.com%2Fauth%2Fdiscord%2Fcallback/);
  assert.match(result, /state=state-abc/);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
