const { getWorkerConfig } = require("./config");

let pool = null;

function getPgModule() {
  return require("pg");
}

function getPool() {
  if (!pool) {
    const { Pool } = getPgModule();
    const config = getWorkerConfig();
    pool = new Pool({
      connectionString: config.databaseUrl,
    });
  }
  return pool;
}

async function query(text, params = []) {
  return getPool().query(text, params);
}

async function withTransaction(run) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function closePool() {
  if (!pool) return;
  const currentPool = pool;
  pool = null;
  await currentPool.end();
}

module.exports = {
  closePool,
  getPool,
  query,
  withTransaction,
};
