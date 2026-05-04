const assert = require("node:assert/strict");

const {
  createMobileSessionToken,
  issueMobileSession,
  verifyMobileSessionToken,
} = require("../apps/api/src/mobile-auth");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

run("createMobileSessionToken and verifyMobileSessionToken round-trip a valid user session", () => {
  const token = createMobileSessionToken({
    discordUserId: "user-123",
    secret: "mobile-session-secret",
    issuedAtSeconds: 1_700_000_000,
    expiresAtSeconds: 1_700_003_600,
  });

  const result = verifyMobileSessionToken(token, "mobile-session-secret", 1_700_000_100);
  assert.equal(result.ok, true);
  assert.equal(result.discordUserId, "user-123");
  assert.equal(result.expiresAtSeconds, 1_700_003_600);
});

run("verifyMobileSessionToken rejects tampered signatures and expired tokens", () => {
  const token = createMobileSessionToken({
    discordUserId: "user-123",
    secret: "mobile-session-secret",
    issuedAtSeconds: 1_700_000_000,
    expiresAtSeconds: 1_700_000_100,
  });
  const tampered = `${token.slice(0, -1)}x`;

  const invalid = verifyMobileSessionToken(tampered, "mobile-session-secret", 1_700_000_050);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, "invalid_signature");

  const expired = verifyMobileSessionToken(token, "mobile-session-secret", 1_700_000_100);
  assert.equal(expired.ok, false);
  assert.equal(expired.code, "expired");
});

run("issueMobileSession clamps ttl and returns a signed session envelope", () => {
  const session = issueMobileSession({
    discordUserId: "user-999",
    secret: "mobile-session-secret",
    ttlSeconds: 9999999,
    nowSeconds: 1_700_000_000,
  });

  assert.equal(session.discordUserId, "user-999");
  assert.equal(session.expiresInSeconds, 30 * 24 * 60 * 60);

  const verification = verifyMobileSessionToken(session.token, "mobile-session-secret", 1_700_000_010);
  assert.equal(verification.ok, true);
  assert.equal(verification.discordUserId, "user-999");
});
