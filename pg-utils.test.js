const http = require("node:http");
const { Pool } = require("pg");

const { createCreatorPostDispatch } = require("../apps/api/src/queries");
const { createServer } = require("../apps/api/src/server");
const apiDb = require("../apps/api/src/db");
const {
  buildSocialOriginFingerprint,
  buildSocialOriginKey,
} = require("../packages/shared/src");

const DEFAULT_DATABASE_URL = "postgres://watchme:watchme@127.0.0.1:5432/watchme_v2";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function postJson(port, path, body, token) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": token,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data = null;
          if (text) {
            try {
              data = JSON.parse(text);
            } catch {
              data = { raw: text };
            }
          }

          if (response.statusCode >= 400) {
            reject(new Error(`HTTP ${response.statusCode}: ${text}`));
            return;
          }

          resolve(data);
        });
      }
    );

    request.once("error", reject);
    request.write(JSON.stringify(body || {}));
    request.end();
  });
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  });
  const originalInternalToken = process.env.INTERNAL_API_TOKEN;
  const internalToken = "social-loop-check-token";
  const discordUserId = `social-loop-test-${Date.now()}`;
  let dispatchId = null;
  let server = null;

  try {
    process.env.INTERNAL_API_TOKEN = internalToken;

    const dispatch = await createCreatorPostDispatch(discordUserId, {
      status: "queued",
      target_platforms_json: ["instagram"],
      payload_json: {
        post_text: "Loop guard smoke",
        metadata_json: {
          source: "social-loop-check",
        },
      },
    });
    dispatchId = dispatch.dispatch_id;

    const originKey = buildSocialOriginKey({
      platform: "instagram",
      dispatchId,
    });
    const originFingerprint = buildSocialOriginFingerprint({
      originKey,
      discordUserId,
      connectionId: "ig-conn-1",
    });

    await pool.query(
      `
        INSERT INTO social_post_publications (
          dispatch_id,
          discord_user_id,
          platform,
          status,
          origin_key,
          origin_fingerprint,
          external_account_id,
          external_post_id,
          external_parent_post_id,
          external_app_id,
          payload_json,
          marker_json,
          error_json,
          external_created_at,
          updated_at
        )
        VALUES (
          $1, $2, 'instagram', 'posted', $3, $4, $5, $6, $7, $8,
          '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, NOW(), NOW()
        )
      `,
      [
        dispatchId,
        discordUserId,
        originKey,
        originFingerprint,
        "ig-user-123",
        "ig-media-1",
        "ig-container-1",
        "watchme-instagram-app",
      ]
    );

    server = createServer();
    const address = await listen(server);
    const port = address.port;

    const directMatch = await postJson(port, "/api/internal/social-events/evaluate", {
      platform: "instagram",
      external_post_id: "ig-media-1",
    }, internalToken);
    const appMatch = await postJson(port, "/api/internal/social-events/evaluate", {
      platform: "instagram",
      external_post_id: "manual-post-2",
      external_app_id: "watchme-instagram-app",
    }, internalToken);
    const markerMatch = await postJson(port, "/api/internal/social-events/evaluate", {
      platform: "instagram",
      external_post_id: "manual-post-3",
      normalized_text: `Seen ${originKey} ${originFingerprint} in provider metadata`,
    }, internalToken);
    const repostMatch = await postJson(port, "/api/internal/social-events/evaluate", {
      platform: "instagram",
      external_post_id: "manual-post-4",
      repost_of_external_post_id: "ig-media-1",
    }, internalToken);
    const manualPass = await postJson(port, "/api/internal/social-events/evaluate", {
      platform: "instagram",
      external_post_id: "manual-post-5",
      external_app_id: "different-app",
      normalized_text: "Creator posted this manually.",
      normalized_urls: ["https://instagram.com/p/manual-post-5"],
    }, internalToken);

    const eventCheckResult = await pool.query(
      `
        SELECT event_id, source_external_id
        FROM event_ingest
        WHERE source_external_id = ANY($1::text[])
        ORDER BY event_id ASC
      `,
      [[
        "ig-media-1",
        "manual-post-2",
        "manual-post-3",
        "manual-post-4",
        "manual-post-5",
      ]]
    );

    const summary = {
      ok: true,
      directMatch,
      appMatch,
      markerMatch,
      repostMatch,
      manualPass,
      matchedEventRows: eventCheckResult.rows,
    };

    console.log(JSON.stringify(summary, null, 2));

    if (directMatch.accepted !== false || directMatch.reason !== "watchme_origin_external_post") {
      throw new Error("Expected direct post id match to be rejected as WatchMe origin.");
    }

    if (directMatch.match?.match_type !== "external_post") {
      throw new Error(`Unexpected direct match type ${directMatch.match?.match_type}`);
    }

    if (appMatch.accepted !== false || appMatch.reason !== "watchme_origin_external_app") {
      throw new Error("Expected external app id match to be rejected as WatchMe origin.");
    }

    if (markerMatch.accepted !== false || markerMatch.reason !== "watchme_origin_marker") {
      throw new Error("Expected origin marker match to be rejected as WatchMe origin.");
    }

    if (repostMatch.accepted !== false || repostMatch.reason !== "watchme_origin_repost_ancestry") {
      throw new Error("Expected repost ancestry match to be rejected as WatchMe origin.");
    }

    if (manualPass.accepted !== true || manualPass.reason !== null) {
      throw new Error("Expected unrelated manual post to pass the WatchMe origin guard.");
    }

    if (eventCheckResult.rows.length !== 0) {
      throw new Error("Social candidate evaluation should not write matching rows into event_ingest.");
    }
  } finally {
    process.env.INTERNAL_API_TOKEN = originalInternalToken;

    try {
      if (dispatchId) {
        await pool.query("DELETE FROM social_post_publications WHERE dispatch_id = $1", [dispatchId]);
        await pool.query("DELETE FROM creator_post_dispatches WHERE dispatch_id = $1", [dispatchId]);
      }
      await pool.query("DELETE FROM users WHERE discord_user_id = $1", [discordUserId]);
    } finally {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
      await pool.end().catch(() => null);
      await apiDb.closePool().catch(() => null);
    }
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
