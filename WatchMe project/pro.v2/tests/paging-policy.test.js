const assert = require("node:assert/strict");

const {
  buildIncidentEscalationWarnings,
  buildPagerPolicy,
  buildPagerWebhookPayload,
  mergePagerSweepWarnings,
  normalizePagerWarningOverrides,
  planPagerActions,
} = require("../apps/api/src/paging");

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

run("new high warning pages immediately", () => {
  const policy = buildPagerPolicy({
    opsPagerMinSeverity: "high",
    opsPagerCooldownSeconds: 300,
    opsPagerReminderSeconds: 1800,
  });
  const plan = planPagerActions({
    warnings: [
      {
        code: "failed_jobs",
        severity: "high",
        count: 2,
        message: "2 jobs are failed.",
      },
    ],
    incidents: [],
    policy,
    now: "2026-04-03T16:00:00.000Z",
  });

  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].eventType, "page");
  assert.equal(plan.actions[0].shouldNotify, true);
});

run("failed delivery obeys cooldown before retrying a page", () => {
  const policy = buildPagerPolicy({
    opsPagerMinSeverity: "high",
    opsPagerCooldownSeconds: 300,
    opsPagerReminderSeconds: 1800,
  });
  const warning = {
    code: "failed_jobs",
    severity: "high",
    count: 1,
    message: "1 job is failed.",
  };
  const incidents = [
    {
      incident_code: "failed_jobs",
      status: "active",
      severity: "high",
      last_delivery_attempt_at: "2026-04-03T16:00:00.000Z",
      last_notified_at: null,
    },
  ];

  const earlyPlan = planPagerActions({
    warnings: [warning],
    incidents,
    policy,
    now: "2026-04-03T16:03:00.000Z",
  });
  assert.equal(earlyPlan.actions[0].eventType, "observe");

  const retryPlan = planPagerActions({
    warnings: [warning],
    incidents,
    policy,
    now: "2026-04-03T16:05:30.000Z",
  });
  assert.equal(retryPlan.actions[0].eventType, "page");
});

run("resolved incidents emit a recovery action when warnings clear", () => {
  const policy = buildPagerPolicy({
    opsPagerMinSeverity: "high",
    opsPagerCooldownSeconds: 300,
    opsPagerReminderSeconds: 1800,
    opsPagerSendRecovery: true,
  });
  const plan = planPagerActions({
    warnings: [],
    incidents: [
      {
        incident_code: "failed_jobs",
        status: "active",
        severity: "high",
        last_count: 3,
        summary_json: {
          message: "3 jobs are failed.",
        },
      },
    ],
    policy,
    now: "2026-04-03T16:10:00.000Z",
  });

  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].eventType, "resolve");
  assert.equal(plan.actions[0].nextStatus, "resolved");
});

run("warning overrides normalize code and default message", () => {
  const warnings = normalizePagerWarningOverrides([
    {
      code: " SOCIAL_FEED_FAILED_POSTS ",
      severity: "critical",
      count: 4,
    },
  ]);

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, "social_feed_failed_posts");
  assert.equal(warnings[0].severity, "critical");
  assert.equal(warnings[0].count, 4);
  assert.equal(warnings[0].message.includes("social_feed_failed_posts"), true);
});

run("incident escalation adds persistent worker health warning", () => {
  const extra = buildIncidentEscalationWarnings({
    baseWarnings: [
      {
        code: "worker_heartbeat_stale",
        severity: "critical",
        count: 2,
        message: "stale",
      },
    ],
    incidents: [
      {
        incident_code: "worker_heartbeat_stale",
        status: "active",
        occurrence_count: 12,
        first_seen_at: "2026-04-03T15:00:00.000Z",
      },
    ],
    config: {
      opsEscalateWorkerHealthMinOccurrences: 10,
      opsEscalateWorkerHealthMinAgeSeconds: 1800,
    },
    nowMs: new Date("2026-04-03T16:00:00.000Z").getTime(),
  });

  assert.equal(extra.length, 1);
  assert.equal(extra[0].code, "worker_heartbeat_stale_persistent");
  assert.equal(extra[0].severity, "critical");
});

run("merge pager warnings skips duplicate escalation codes", () => {
  const merged = mergePagerSweepWarnings(
    [{ code: "failed_jobs", severity: "high", count: 1, message: "x" }],
    [{ code: "failed_jobs", severity: "critical", count: 9, message: "dup" }]
  );
  assert.equal(merged.length, 1);
});

run("pager webhook payload formats recovery messages cleanly", () => {
  const policy = buildPagerPolicy({
    opsPagerServiceName: "WatchMe V2",
  });
  const payload = buildPagerWebhookPayload({
    action: {
      incidentCode: "failed_jobs",
      severity: "high",
      count: 2,
      eventType: "resolve",
      message: "Jobs are healthy again.",
      now: "2026-04-03T16:12:00.000Z",
    },
    policy,
  });

  assert.equal(payload.username, "WatchMe V2 Pager");
  assert.equal(payload.content, "WatchMe V2 recovery: failed_jobs cleared.");
  assert.equal(payload.embeds[0].title, "Recovery: failed_jobs");
  assert.equal(payload.embeds[0].fields[0].value, "HIGH");
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
