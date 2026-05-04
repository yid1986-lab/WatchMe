const { withTransaction, query } = require("./db");
const { log } = require("./logger");

async function releaseStaleLocks(lockTimeoutSeconds) {
  const result = await query(
    `
      UPDATE job_queue
      SET
        status = 'pending',
        locked_at = NULL,
        locked_by = NULL,
        updated_at = NOW()
      WHERE status = 'processing'
        AND locked_at IS NOT NULL
        AND locked_at < NOW() - make_interval(secs => $1)
      RETURNING job_id
    `,
    [lockTimeoutSeconds]
  );

  if (result.rowCount) {
    log("warn", "queue", `Released ${result.rowCount} stale job lock(s)`);
  }

  return result.rowCount || 0;
}

async function claimJobs(workerName, batchSize, queues = []) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `
        WITH next_jobs AS (
          SELECT job_id
          FROM job_queue
          WHERE status = 'pending'
            AND available_at <= NOW()
            AND (
              cardinality($3::text[]) = 0
              OR queue_name = ANY($3::text[])
            )
          ORDER BY priority ASC, job_id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        )
        UPDATE job_queue q
        SET
          status = 'processing',
          locked_at = NOW(),
          locked_by = $2,
          attempts = q.attempts + 1,
          updated_at = NOW()
        FROM next_jobs
        WHERE q.job_id = next_jobs.job_id
        RETURNING q.*
      `,
      [batchSize, workerName, queues]
    );

    return result.rows;
  });
}

async function completeJob(jobId) {
  await query(
    `
      UPDATE job_queue
      SET
        status = 'completed',
        locked_at = NULL,
        locked_by = NULL,
        updated_at = NOW()
      WHERE job_id = $1
    `,
    [jobId]
  );
}

async function failJob(job, errorMessage) {
  const shouldRetry = Number(job.attempts || 0) < Number(job.max_attempts || 0);
  const retryDelaySeconds = Math.min(300, Math.max(15, Math.pow(2, Number(job.attempts || 1)) * 5));

  await query(
    `
      UPDATE job_queue
      SET
        status = $2,
        locked_at = NULL,
        locked_by = NULL,
        available_at = CASE
          WHEN $2 = 'pending' THEN NOW() + make_interval(secs => $4)
          ELSE available_at
        END,
        last_error = $3,
        updated_at = NOW()
      WHERE job_id = $1
    `,
    [job.job_id, shouldRetry ? "pending" : "failed", errorMessage, retryDelaySeconds]
  );
}

module.exports = {
  claimJobs,
  completeJob,
  failJob,
  releaseStaleLocks,
};
