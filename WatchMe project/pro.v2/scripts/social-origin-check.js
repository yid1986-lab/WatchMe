const { Pool } = require("pg");

const { upsertCreatorSocialConnection, createCreatorPostDispatch } = require("../apps/api/src/queries");
const apiDb = require("../apps/api/src/db");
const { handleJob } = require("../apps/worker/src/handlers");
const workerDb = require("../apps/worker/src/db");
const { JOB_TYPES } = require("../packages/shared/src");

const DEFAULT_DATABASE_URL = "postgres://watchme:watchme@127.0.0.1:5432/watchme_v2";

const SOCIAL_PUBLICATIONS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS social_post_publications (
  publication_id BIGSERIAL PRIMARY KEY,
  dispatch_id BIGINT NOT NULL REFERENCES creator_post_dispatches(dispatch_id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL REFERENCES users(discord_user_id),
  platform TEXT NOT NULL,
  connection_id BIGINT REFERENCES creator_social_connections(connection_id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  origin_key TEXT NOT NULL,
  origin_fingerprint TEXT,
  external_account_id TEXT,
  external_post_id TEXT,
  external_parent_post_id TEXT,
  external_app_id TEXT,
  external_url TEXT,
  external_created_at TIMESTAMPTZ,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  marker_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS social_post_publications_status_idx
  ON social_post_publications (status, created_at);
CREATE INDEX IF NOT EXISTS social_post_publications_account_idx
  ON social_post_publications (platform, external_account_id, external_created_at);
CREATE INDEX IF NOT EXISTS social_post_publications_origin_fingerprint_idx
  ON social_post_publications (platform, origin_fingerprint)
  WHERE origin_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS social_post_publications_external_app_idx
  ON social_post_publications (platform, external_app_id, external_created_at)
  WHERE external_app_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS social_post_publications_origin_idx
  ON social_post_publications (platform, origin_key);
CREATE UNIQUE INDEX IF NOT EXISTS social_post_publications_external_post_idx
  ON social_post_publications (platform, external_post_id)
  WHERE external_post_id IS NOT NULL;
`;

async function ensureSocialPublicationSchema(pool) {
  await pool.query(SOCIAL_PUBLICATIONS_SCHEMA_SQL);
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  });

  const discordUserId = `social-origin-test-${Date.now()}`;
  let dispatchId = null;

  try {
    await ensureSocialPublicationSchema(pool);

    await upsertCreatorSocialConnection(discordUserId, "x", {
      external_account_id: "x-account-1",
      external_account_name: "Creator X",
      status: "active",
      metadata_json: {
        appId: "watchme-test",
        source: "social-origin-check",
      },
    });

    const dispatch = await createCreatorPostDispatch(discordUserId, {
      status: "queued",
      target_platforms_json: ["x", "x", "instagram"],
      payload_json: {
        post_text: "Loop prevention test post",
        link_url: "https://watchme.example/social-loop",
        media_urls_json: [],
        metadata_json: {
          source: "verification",
        },
      },
    });
    dispatchId = dispatch.dispatch_id;

    await handleJob({
      job_type: JOB_TYPES.DISPATCH_SOCIAL_POST,
      payload_json: {
        dispatchId,
      },
    });

    const publicationResult = await pool.query(
      `
        SELECT
          publication_id,
          platform,
          status,
          origin_key,
          origin_fingerprint,
          external_account_id,
          marker_json
        FROM social_post_publications
        WHERE dispatch_id = $1
        ORDER BY publication_id ASC
      `,
      [dispatchId]
    );
    const dispatchResult = await pool.query(
      `
        SELECT status, error_json
        FROM creator_post_dispatches
        WHERE dispatch_id = $1
      `,
      [dispatchId]
    );

    const summary = {
      ok: true,
      publicationCount: publicationResult.rows.length,
      publications: publicationResult.rows,
      dispatch: dispatchResult.rows[0] || null,
    };

    console.log(JSON.stringify(summary, null, 2));

    if (publicationResult.rows.length !== 1) {
      throw new Error(`Expected 1 publication row, found ${publicationResult.rows.length}`);
    }

    const publication = publicationResult.rows[0];
    if (publication.status !== "recorded_placeholder") {
      throw new Error(`Expected recorded_placeholder status, found ${publication.status}`);
    }

    if (!String(publication.origin_key || "").startsWith("wm-origin:v1:x:")) {
      throw new Error(`Unexpected origin_key ${publication.origin_key}`);
    }

    if (!String(publication.origin_fingerprint || "").startsWith("wmf1_")) {
      throw new Error(`Unexpected origin_fingerprint ${publication.origin_fingerprint}`);
    }

    if ((dispatchResult.rows[0] || {}).status !== "partial") {
      throw new Error(`Expected dispatch status partial, found ${(dispatchResult.rows[0] || {}).status}`);
    }
  } finally {
    try {
      if (dispatchId) {
        await pool.query("DELETE FROM social_post_publications WHERE dispatch_id = $1", [dispatchId]);
        await pool.query("DELETE FROM creator_post_dispatches WHERE dispatch_id = $1", [dispatchId]);
      }
      await pool.query("DELETE FROM creator_social_connections WHERE discord_user_id = $1", [discordUserId]);
      await pool.query("DELETE FROM users WHERE discord_user_id = $1", [discordUserId]);
    } finally {
      await pool.end().catch(() => null);
      await apiDb.closePool().catch(() => null);
      await workerDb.closePool().catch(() => null);
    }
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
