const http = require("node:http");
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

function startStubServer(port, state) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/v22\.0\/([^/]+)\/feed$/);

    if (req.method === "POST" && match) {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }

      const body = Buffer.concat(chunks).toString("utf8");
      const params = new URLSearchParams(body);
      const pageId = decodeURIComponent(match[1]);
      const accessToken = params.get("access_token");
      const message = params.get("message") || "";
      const link = params.get("link") || "";

      if (!accessToken) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Missing page access token" } }));
        return;
      }

      state.requests.push({
        pageId,
        accessToken,
        message,
        link,
      });

      const postId = `${pageId}_stubpost_${state.requests.length}`;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: postId }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Not found" } }));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  });

  const state = {
    requests: [],
  };
  const port = 39440;
  const originalFacebookApiBaseUrl = process.env.FACEBOOK_API_BASE_URL;
  const originalFacebookGraphVersion = process.env.FACEBOOK_GRAPH_VERSION;
  const originalFacebookAppId = process.env.FACEBOOK_APP_ID;
  const discordUserId = `facebook-social-test-${Date.now()}`;
  let dispatchId = null;
  let server = null;

  try {
    process.env.FACEBOOK_API_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.FACEBOOK_GRAPH_VERSION = "v22.0";
    process.env.FACEBOOK_APP_ID = "watchme-facebook-app";

    await ensureSocialPublicationSchema(pool);
    server = await startStubServer(port, state);

    await upsertCreatorSocialConnection(discordUserId, "facebook", {
      external_account_id: "page-123",
      external_account_name: "WatchMe Page",
      access_token: "page-token-123",
      status: "active",
      metadata_json: {
        app_id: "watchme-facebook-app",
        source: "facebook-social-check",
      },
    });

    const dispatch = await createCreatorPostDispatch(discordUserId, {
      status: "queued",
      target_platforms_json: ["facebook"],
      payload_json: {
        post_text: "WatchMe V2 Facebook provider smoke",
        link_url: "https://watchme.example/facebook-social",
        media_urls_json: [],
        metadata_json: {
          source: "facebook-provider-smoke",
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
          external_post_id,
          external_app_id,
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
      stubRequests: state.requests.length,
      lastRequest: state.requests[state.requests.length - 1] || null,
      publications: publicationResult.rows,
      dispatch: dispatchResult.rows[0] || null,
    };

    console.log(JSON.stringify(summary, null, 2));

    if (state.requests.length !== 1) {
      throw new Error(`Expected 1 Facebook API request, found ${state.requests.length}`);
    }

    const publication = publicationResult.rows[0] || null;
    if (!publication) {
      throw new Error("Expected a Facebook publication receipt row.");
    }

    if (publication.status !== "posted") {
      throw new Error(`Expected posted publication status, found ${publication.status}`);
    }

    if (publication.external_post_id !== "page-123_stubpost_1") {
      throw new Error(`Unexpected external post id ${publication.external_post_id}`);
    }

    if (publication.external_app_id !== "watchme-facebook-app") {
      throw new Error(`Unexpected external app id ${publication.external_app_id}`);
    }

    if ((dispatchResult.rows[0] || {}).status !== "completed") {
      throw new Error(`Expected dispatch status completed, found ${(dispatchResult.rows[0] || {}).status}`);
    }
  } finally {
    process.env.FACEBOOK_API_BASE_URL = originalFacebookApiBaseUrl;
    process.env.FACEBOOK_GRAPH_VERSION = originalFacebookGraphVersion;
    process.env.FACEBOOK_APP_ID = originalFacebookAppId;

    try {
      if (dispatchId) {
        await pool.query("DELETE FROM social_post_publications WHERE dispatch_id = $1", [dispatchId]);
        await pool.query("DELETE FROM creator_post_dispatches WHERE dispatch_id = $1", [dispatchId]);
      }
      await pool.query("DELETE FROM creator_social_connections WHERE discord_user_id = $1", [discordUserId]);
      await pool.query("DELETE FROM users WHERE discord_user_id = $1", [discordUserId]);
    } finally {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
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
