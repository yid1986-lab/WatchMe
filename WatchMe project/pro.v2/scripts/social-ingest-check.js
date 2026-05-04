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
  const internalToken = "social-ingest-check-token";
  const blockedDiscordUserId = `social-ingest-blocked-${Date.now()}`;
  let blockedDispatchId = null;
  let server = null;

  try {
    process.env.INTERNAL_API_TOKEN = internalToken;

    const baselineJobCountResult = await pool.query("SELECT COUNT(*)::int AS count FROM job_queue");
    const baselineEventCountResult = await pool.query("SELECT COUNT(*)::int AS count FROM event_ingest");
    const baselineJobCount = Number(baselineJobCountResult.rows[0]?.count || 0);
    const baselineEventCount = Number(baselineEventCountResult.rows[0]?.count || 0);

    const blockedDispatch = await createCreatorPostDispatch(blockedDiscordUserId, {
      status: "queued",
      target_platforms_json: ["instagram"],
      payload_json: {
        post_text: "Blocked social ingest smoke",
      },
    });
    blockedDispatchId = blockedDispatch.dispatch_id;

    const blockedOriginKey = buildSocialOriginKey({
      platform: "instagram",
      dispatchId: blockedDispatchId,
    });
    const blockedOriginFingerprint = buildSocialOriginFingerprint({
      originKey: blockedOriginKey,
      discordUserId: blockedDiscordUserId,
      connectionId: "blocked-ig-conn",
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
        blockedDispatchId,
        blockedDiscordUserId,
        blockedOriginKey,
        blockedOriginFingerprint,
        "ig-user-blocked",
        "ig-media-blocked",
        "ig-container-blocked",
        "watchme-instagram-app",
      ]
    );

    server = createServer();
    const address = await listen(server);
    const port = address.port;

    const acceptedResponse = await postJson(port, "/api/internal/social-events", {
      platform: "instagram",
      external_account_id: "ig-user-manual",
      external_post_id: "ig-manual-post-1",
      external_app_id: "creator-instagram-app",
      source_url: "https://instagram.com/watchme_creator",
      normalized_text: "Creator wrote this manually and it should be stored.",
      normalized_urls: ["https://instagram.com/p/ig-manual-post-1"],
      published_at: "2026-04-03T12:34:56.000Z",
      metadata_json: {
        source: "social-ingest-check",
        type: "manual_social_post",
      },
    }, internalToken);

    const blockedResponse = await postJson(port, "/api/internal/social-events", {
      platform: "instagram",
      external_account_id: "ig-user-blocked",
      external_post_id: "ig-media-blocked",
      external_app_id: "watchme-instagram-app",
      normalized_text: `This should be blocked ${blockedOriginKey}`,
      published_at: "2026-04-03T12:35:56.000Z",
      metadata_json: {
        source: "social-ingest-check",
      },
    }, internalToken);

    const acceptedEventResult = await pool.query(
      `
        SELECT event_id, platform, event_type, source_key, source_external_id, processing_state, payload_json
        FROM event_ingest
        WHERE dedupe_key = $1
      `,
      ["instagram:social.post.created:instagram:ig-user-manual:ig-manual-post-1:2026-04-03t12:34:56.000z"]
    );

    const afterJobCountResult = await pool.query("SELECT COUNT(*)::int AS count FROM job_queue");
    const afterEventCountResult = await pool.query("SELECT COUNT(*)::int AS count FROM event_ingest");
    const afterJobCount = Number(afterJobCountResult.rows[0]?.count || 0);
    const afterEventCount = Number(afterEventCountResult.rows[0]?.count || 0);

    const summary = {
      ok: true,
      acceptedResponse,
      blockedResponse,
      acceptedEvent: acceptedEventResult.rows[0] || null,
      eventIngestDelta: afterEventCount - baselineEventCount,
      jobQueueDelta: afterJobCount - baselineJobCount,
    };

    console.log(JSON.stringify(summary, null, 2));

    if (acceptedResponse.ingested !== true || acceptedResponse.accepted !== true) {
      throw new Error("Expected the manual social candidate to be accepted and stored.");
    }

    if (acceptedResponse.enqueued !== true) {
      throw new Error("Accepted social ingest should enqueue worker jobs now.");
    }

    const acceptedEvent = acceptedEventResult.rows[0] || null;
    if (!acceptedEvent) {
      throw new Error("Expected one accepted social event row in event_ingest.");
    }

    if (acceptedEvent.event_type !== "social.post.created") {
      throw new Error(`Unexpected social event type ${acceptedEvent.event_type}`);
    }

    if (acceptedEvent.source_key !== "instagram:ig-user-manual") {
      throw new Error(`Unexpected social source key ${acceptedEvent.source_key}`);
    }

    if (acceptedEvent.source_external_id !== "ig-manual-post-1") {
      throw new Error(`Unexpected social source external id ${acceptedEvent.source_external_id}`);
    }

    if (acceptedEvent.processing_state !== "received") {
      throw new Error(`Expected received processing_state, found ${acceptedEvent.processing_state}`);
    }

    if (blockedResponse.ingested !== false || blockedResponse.accepted !== false) {
      throw new Error("Expected the WatchMe-origin social candidate to be rejected before ingest.");
    }

    if (blockedResponse.reason !== "watchme_origin_external_post") {
      throw new Error(`Unexpected blocked reason ${blockedResponse.reason}`);
    }

    if (afterEventCount !== baselineEventCount + 1) {
      throw new Error("Expected exactly one accepted event_ingest row to be added.");
    }

    if (afterJobCount !== baselineJobCount + 1) {
      throw new Error("Expected exactly one queue job to be created for the accepted social event.");
    }
  } finally {
    process.env.INTERNAL_API_TOKEN = originalInternalToken;

    try {
      if (blockedDispatchId) {
        await pool.query("DELETE FROM job_queue WHERE payload_json->>'sourceExternalId' IN ($1, $2)", [
          "ig-manual-post-1",
          "ig-media-blocked",
        ]);
        await pool.query("DELETE FROM social_post_publications WHERE dispatch_id = $1", [blockedDispatchId]);
        await pool.query("DELETE FROM creator_post_dispatches WHERE dispatch_id = $1", [blockedDispatchId]);
      }

      await pool.query("DELETE FROM event_ingest WHERE source_external_id IN ($1, $2)", [
        "ig-manual-post-1",
        "ig-media-blocked",
      ]);
      await pool.query("DELETE FROM users WHERE discord_user_id = $1", [blockedDiscordUserId]);
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
