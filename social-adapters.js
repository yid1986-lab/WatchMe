const { getPool, query } = require("./db");
const { getQueueStats } = require("./queries");

const PAGER_LOCK_KEY = 21430503;
const ALLOWED_SEVERITIES = ["low", "medium", "high", "critical"];
const SEVERITY_RANK = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};
const INCIDENT_STATUS_ACTIVE = "active";
const INCIDENT_STATUS_RESOLVED = "resolved";
let pagerSchemaEnsured = false;

function normalizeText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizePagerSeverity(value, fallback = "high") {
  const normalized = normalizeText(value)?.toLowerCase();
  if (normalized && ALLOWED_SEVERITIES.includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function getSeverityRank(value) {
  return SEVERITY_RANK[normalizePagerSeverity(value, "low")] || 0;
}

function isSeverityAtLeast(value, minSeverity) {
  return getSeverityRank(value) >= getSeverityRank(minSeverity);
}

function ageSeconds(value, nowMs = Date.now()) {
  if (!value) return null;
  const next = new Date(value).getTime();
  if (!Number.isFinite(next)) {
    return null;
  }
  return Math.max(0, Math.floor((nowMs - next) / 1000));
}

function buildPagerPolicy(config = {}) {
  return {
    minSeverity: normalizePagerSeverity(config.opsPagerMinSeverity, "high"),
    cooldownSeconds: Math.max(0, Number(config.opsPagerCooldownSeconds || 900)),
    reminderSeconds: Math.max(0, Number(config.opsPagerReminderSeconds || 3600)),
    sendRecovery: config.opsPagerSendRecovery !== false,
    serviceName: normalizeText(config.opsPagerServiceName) || "WatchMe V2",
    deliveryTargetConfigured: Boolean(normalizeText(config.opsPagerDiscordWebhookUrl)),
  };
}

function normalizePagerWarningOverride(item = {}) {
  const code = normalizeText(item.code)?.toLowerCase();
  if (!code) {
    throw new Error("warning_overrides[].code is required");
  }

  const severity = normalizePagerSeverity(item.severity, "high");
  const count = Math.max(0, Number(item.count || 0));
  const message =
    normalizeText(item.message) ||
    `${code} triggered a ${severity} pager warning.`;

  return {
    code,
    severity,
    count,
    message,
  };
}

function normalizePagerWarningOverrides(items = []) {
  if (!Array.isArray(items)) {
    throw new Error("warning_overrides must be an array");
  }

  return items.map((item) => normalizePagerWarningOverride(item));
}

function buildIncidentEscalationWarnings({
  baseWarnings = [],
  incidents = [],
  config = {},
  nowMs = Date.now(),
} = {}) {
  const extra = [];
  const normalize = (code) => normalizeText(code)?.toLowerCase();
  const baseCodes = new Set(
    (Array.isArray(baseWarnings) ? baseWarnings : [])
      .map((w) => normalize(w.code))
      .filter(Boolean)
  );

  const minOcc = Math.max(1, Number(config.opsEscalateWorkerHealthMinOccurrences ?? 10));
  const minAgeSec = Math.max(0, Number(config.opsEscalateWorkerHealthMinAgeSeconds ?? 1800));

  for (const healthCode of ["worker_heartbeat_stale", "worker_heartbeat_missing"]) {
    if (!baseCodes.has(healthCode)) {
      continue;
    }

    const incident = (Array.isArray(incidents) ? incidents : []).find(
      (row) => normalize(row.incident_code) === healthCode && row.status === INCIDENT_STATUS_ACTIVE
    );
    if (!incident) {
      continue;
    }

    const occ = Math.max(0, Number(incident.occurrence_count || 0));
    const ageFirst = ageSeconds(incident.first_seen_at, nowMs);
    const oldEnough = minAgeSec > 0 && ageFirst !== null && ageFirst >= minAgeSec;
    if (occ < minOcc && !oldEnough) {
      continue;
    }

    const persistentCode = `${healthCode}_persistent`;
    extra.push({
      code: persistentCode,
      severity: "critical",
      count: occ,
      message: `${healthCode} persists (${occ} active pager sweep(s); first seen ${
        ageFirst === null ? "unknown" : `${ageFirst}s`
      } ago). Escalation: verify worker processes, systemd, and database connectivity.`,
    });
  }

  return extra;
}

function mergePagerSweepWarnings(statsWarnings, escalationWarnings) {
  const codes = new Set();
  const merged = [];
  for (const w of Array.isArray(statsWarnings) ? statsWarnings : []) {
    const c = normalizeText(w.code)?.toLowerCase();
    if (c) {
      codes.add(c);
    }
    merged.push(w);
  }
  for (const w of Array.isArray(escalationWarnings) ? escalationWarnings : []) {
    const c = normalizeText(w.code)?.toLowerCase();
    if (c && codes.has(c)) {
      continue;
    }
    if (c) {
      codes.add(c);
    }
    merged.push(w);
  }
  return merged;
}

function getQueueStatsOptsFromConfig(config = {}) {
  return {
    lockTimeoutSeconds: config.workerLockTimeoutSeconds,
    backlogWarningSeconds: config.opsBacklogWarningSeconds,
    leaseWarningSeconds: config.opsLeaseWarningSeconds,
    workerHeartbeatWarningSeconds: config.opsWorkerHeartbeatWarningSeconds,
    workerRssWarningBytes: config.opsWorkerRssWarningBytes,
    workerHeapWarningBytes: config.opsWorkerHeapWarningBytes,
    workerRestartStormWindowSeconds: config.opsWorkerRestartStormWindowSeconds,
    workerRestartStormMinCount: config.opsWorkerRestartStormMinCount,
    pagerDeliveryFailWindowSeconds: config.opsPagerDeliveryFailWindowSeconds,
    pagerDeliveryFailMinCount: config.opsPagerDeliveryFailMinCount,
  };
}

function filterPageableWarnings(warnings = [], policy = {}) {
  return (Array.isArray(warnings) ? warnings : [])
    .map((warning) => ({
      code: normalizeText(warning.code)?.toLowerCase(),
      severity: normalizePagerSeverity(warning.severity, "high"),
      count: Math.max(0, Number(warning.count || 0)),
      message: normalizeText(warning.message) || "Pager warning triggered.",
    }))
    .filter((warning) => warning.code && isSeverityAtLeast(warning.severity, policy.minSeverity));
}

function getIncidentNotificationAnchor(incident = {}) {
  if (!incident || typeof incident !== "object") {
    return null;
  }

  return (
    normalizeText(incident.last_notified_at) ||
    normalizeText(incident.last_delivery_attempt_at) ||
    normalizeText(incident.last_seen_at) ||
    normalizeText(incident.first_seen_at)
  );
}

function decidePagerEventType(warning = {}, incident = null, policy = {}, nowMs = Date.now()) {
  if (!incident) {
    return "page";
  }

  if (incident.status !== INCIDENT_STATUS_ACTIVE) {
    return "page";
  }

  if (getSeverityRank(warning.severity) > getSeverityRank(incident.severity)) {
    return "page";
  }

  if (!incident.last_notified_at) {
    if (!incident.last_delivery_attempt_at) {
      return "page";
    }

    if (ageSeconds(incident.last_delivery_attempt_at, nowMs) >= Number(policy.cooldownSeconds || 0)) {
      return "page";
    }

    return "observe";
  }

  if (
    Number(policy.reminderSeconds || 0) > 0 &&
    ageSeconds(incident.last_notified_at, nowMs) >= Number(policy.reminderSeconds || 0)
  ) {
    return "reminder";
  }

  return "observe";
}

function planPagerActions({ warnings = [], incidents = [], policy = {}, now = new Date().toISOString() } = {}) {
  const nowValue = new Date(now);
  const nowIso = nowValue.toISOString();
  const nowMs = nowValue.getTime();
  const activeWarnings = filterPageableWarnings(warnings, policy);
  const incidentMap = new Map(
    (Array.isArray(incidents) ? incidents : [])
      .filter((incident) => normalizeText(incident.incident_code))
      .map((incident) => [String(incident.incident_code).toLowerCase(), incident])
  );
  const seenCodes = new Set();
  const actions = [];

  for (const warning of activeWarnings) {
    const incident = incidentMap.get(warning.code) || null;
    const eventType = decidePagerEventType(warning, incident, policy, nowMs);
    const notificationAnchor = getIncidentNotificationAnchor(incident);

    actions.push({
      incidentCode: warning.code,
      severity: warning.severity,
      count: warning.count,
      message: warning.message,
      incident: incident || null,
      warning,
      nextStatus: INCIDENT_STATUS_ACTIVE,
      eventType,
      shouldNotify: eventType === "page" || eventType === "reminder",
      notificationAnchor,
      now: nowIso,
    });
    seenCodes.add(warning.code);
  }

  for (const incident of Array.isArray(incidents) ? incidents : []) {
    const incidentCode = normalizeText(incident.incident_code)?.toLowerCase();
    if (!incidentCode || seenCodes.has(incidentCode) || incident.status !== INCIDENT_STATUS_ACTIVE) {
      continue;
    }

    actions.push({
      incidentCode,
      severity: normalizePagerSeverity(incident.severity, "high"),
      count: Math.max(0, Number(incident.last_count || 0)),
      message: normalizeText(incident.summary_json?.message) || `${incidentCode} recovered.`,
      incident,
      warning: null,
      nextStatus: INCIDENT_STATUS_RESOLVED,
      eventType: policy.sendRecovery ? "resolve" : "clear",
      shouldNotify: Boolean(policy.sendRecovery),
      notificationAnchor: getIncidentNotificationAnchor(incident),
      now: nowIso,
    });
  }

  return {
    now: nowIso,
    activeWarnings,
    actions,
  };
}

function getPagerColor(severity, eventType) {
  if (eventType === "resolve") {
    return 0x3BA55D;
  }

  switch (normalizePagerSeverity(severity, "high")) {
    case "critical":
      return 0xED4245;
    case "high":
      return 0xFAA61A;
    case "medium":
      return 0x5865F2;
    default:
      return 0x99AAB5;
  }
}

function buildPagerWebhookPayload({ action = {}, policy = {} } = {}) {
  const titlePrefix = action.eventType === "resolve"
    ? "Recovery"
    : action.eventType === "reminder"
      ? "Reminder"
      : "Page";
  const countValue = Math.max(0, Number(action.count || action.warning?.count || 0));
  const description =
    normalizeText(action.message) ||
    normalizeText(action.warning?.message) ||
    "Pager event triggered.";
  const content = action.eventType === "resolve"
    ? `${policy.serviceName} recovery: ${action.incidentCode} cleared.`
    : `${policy.serviceName} paging: ${action.severity.toUpperCase()} ${action.incidentCode} (${countValue}).`;

  return {
    username: `${policy.serviceName} Pager`,
    content,
    embeds: [
      {
        title: `${titlePrefix}: ${action.incidentCode}`,
        description,
        color: getPagerColor(action.severity, action.eventType),
        fields: [
          {
            name: "Severity",
            value: action.severity.toUpperCase(),
            inline: true,
          },
          {
            name: "Count",
            value: String(countValue),
            inline: true,
          },
          {
            name: "Event",
            value: action.eventType,
            inline: true,
          },
        ],
        timestamp: action.now || new Date().toISOString(),
      },
    ],
  };
}

async function sendPagerDiscordWebhook(webhookUrl, payload) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(`Pager webhook failed with HTTP ${response.status}: ${text || response.statusText}`);
  }

  return {
    status: response.status,
    body: data,
  };
}

async function runDb(executor, text, params = []) {
  if (executor) {
    return executor.query(text, params);
  }
  return query(text, params);
}

async function ensurePagerSchema(executor = null) {
  if (pagerSchemaEnsured) {
    return;
  }

  await runDb(
    executor,
    `
      CREATE TABLE IF NOT EXISTS ops_pager_incidents (
        incident_id BIGSERIAL PRIMARY KEY,
        incident_code TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        severity TEXT NOT NULL,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_notified_at TIMESTAMPTZ,
        last_delivery_attempt_at TIMESTAMPTZ,
        last_delivery_status TEXT,
        last_delivery_error TEXT,
        last_resolved_at TIMESTAMPTZ,
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        last_count INTEGER NOT NULL DEFAULT 0,
        page_count INTEGER NOT NULL DEFAULT 0,
        recovery_count INTEGER NOT NULL DEFAULT 0,
        summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS ops_pager_incidents_status_idx
        ON ops_pager_incidents (status, severity, updated_at);

      CREATE TABLE IF NOT EXISTS ops_pager_deliveries (
        delivery_id BIGSERIAL PRIMARY KEY,
        incident_id BIGINT REFERENCES ops_pager_incidents(incident_id) ON DELETE CASCADE,
        incident_code TEXT NOT NULL,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        delivery_target TEXT,
        status TEXT NOT NULL DEFAULT 'sent',
        message_text TEXT,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS ops_pager_deliveries_created_idx
        ON ops_pager_deliveries (created_at DESC);

      CREATE INDEX IF NOT EXISTS ops_pager_deliveries_incident_idx
        ON ops_pager_deliveries (incident_id, created_at DESC);
    `
  );

  pagerSchemaEnsured = true;
}

async function listPagerIncidents({ executor = null, includeResolved = true, limit = 50 } = {}) {
  await ensurePagerSchema(executor);
  const params = [Math.max(1, Number(limit || 50))];
  let where = "";

  if (!includeResolved) {
    params.push(INCIDENT_STATUS_ACTIVE);
    where = `WHERE status = $2`;
  }

  const result = await runDb(
    executor,
    `
      SELECT *
      FROM ops_pager_incidents
      ${where}
      ORDER BY
        CASE WHEN status = '${INCIDENT_STATUS_ACTIVE}' THEN 0 ELSE 1 END,
        updated_at DESC,
        incident_id DESC
      LIMIT $1
    `,
    params
  );

  return result.rows;
}

async function listPagerDeliveries({ executor = null, limit = 20 } = {}) {
  await ensurePagerSchema(executor);
  const result = await runDb(
    executor,
    `
      SELECT *
      FROM ops_pager_deliveries
      ORDER BY created_at DESC, delivery_id DESC
      LIMIT $1
    `,
    [Math.max(1, Number(limit || 20))]
  );

  return result.rows;
}

async function savePagerIncident(executor, action, nowIso) {
  const warningSummary = action.warning || {
    code: action.incidentCode,
    severity: action.severity,
    count: action.count,
    message: action.message,
  };

  const result = await runDb(
    executor,
    `
      INSERT INTO ops_pager_incidents (
        incident_code,
        status,
        severity,
        first_seen_at,
        last_seen_at,
        occurrence_count,
        last_count,
        summary_json,
        updated_at,
        last_resolved_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4::timestamptz,
        $4::timestamptz,
        1,
        $5,
        $6::jsonb,
        $4::timestamptz,
        CASE WHEN $2 = 'resolved' THEN $4::timestamptz ELSE NULL END
      )
      ON CONFLICT (incident_code) DO UPDATE SET
        status = EXCLUDED.status,
        severity = EXCLUDED.severity,
        last_seen_at = EXCLUDED.last_seen_at,
        occurrence_count = CASE
          WHEN EXCLUDED.status = 'active' THEN ops_pager_incidents.occurrence_count + 1
          ELSE ops_pager_incidents.occurrence_count
        END,
        last_count = EXCLUDED.last_count,
        summary_json = EXCLUDED.summary_json,
        updated_at = EXCLUDED.updated_at,
        last_resolved_at = CASE
          WHEN EXCLUDED.status = 'resolved' THEN EXCLUDED.updated_at
          ELSE ops_pager_incidents.last_resolved_at
        END
      RETURNING *
    `,
    [
      action.incidentCode,
      action.nextStatus,
      normalizePagerSeverity(action.severity, "high"),
      nowIso,
      Math.max(0, Number(action.count || 0)),
      JSON.stringify(warningSummary),
    ]
  );

  return result.rows[0] || null;
}

async function recordPagerDelivery(executor, incident = {}, action = {}, delivery = {}) {
  const result = await runDb(
    executor,
    `
      INSERT INTO ops_pager_deliveries (
        incident_id,
        incident_code,
        event_type,
        severity,
        delivery_target,
        status,
        message_text,
        payload_json,
        response_json,
        error_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)
      RETURNING *
    `,
    [
      incident.incident_id || null,
      action.incidentCode,
      action.eventType,
      normalizePagerSeverity(action.severity, "high"),
      delivery.deliveryTarget || null,
      delivery.status || "sent",
      action.message || null,
      JSON.stringify(delivery.payload || {}),
      JSON.stringify(delivery.response || {}),
      JSON.stringify(delivery.error || {}),
    ]
  );

  return result.rows[0] || null;
}

async function updateIncidentAfterDelivery(executor, incidentId, delivery = {}, nowIso) {
  const eventType = normalizeText(delivery.eventType)?.toLowerCase() || "page";
  const status = normalizeText(delivery.status)?.toLowerCase() || "sent";
  const pageIncrement = status === "sent" && (eventType === "page" || eventType === "reminder") ? 1 : 0;
  const recoveryIncrement = status === "sent" && eventType === "resolve" ? 1 : 0;
  const lastNotifiedAt = status === "sent" ? nowIso : null;
  const result = await runDb(
    executor,
    `
      UPDATE ops_pager_incidents
      SET
        last_delivery_attempt_at = $2::timestamptz,
        last_delivery_status = $3,
        last_delivery_error = $4,
        last_notified_at = COALESCE($5::timestamptz, last_notified_at),
        page_count = page_count + $6,
        recovery_count = recovery_count + $7,
        updated_at = $2::timestamptz
      WHERE incident_id = $1
      RETURNING *
    `,
    [
      incidentId,
      nowIso,
      status,
      delivery.error?.message || null,
      lastNotifiedAt,
      pageIncrement,
      recoveryIncrement,
    ]
  );

  return result.rows[0] || null;
}

async function withPagerLock(run) {
  const client = await getPool().connect();
  let locked = false;

  try {
    await ensurePagerSchema(client);
    const result = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [PAGER_LOCK_KEY]);
    locked = Boolean(result.rows[0]?.locked);

    if (!locked) {
      return {
        locked: false,
      };
    }

    return await run(client);
  } finally {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock($1)", [PAGER_LOCK_KEY]);
    }
    client.release();
  }
}

async function getPagerStatus({ config = {}, includeResolved = true } = {}) {
  const policy = buildPagerPolicy(config);
  const stats = await getQueueStats(getQueueStatsOptsFromConfig(config));
  const [incidents, recentDeliveries] = await Promise.all([
    listPagerIncidents({ includeResolved, limit: 50 }),
    listPagerDeliveries({ limit: 20 }),
  ]);

  const escalation = buildIncidentEscalationWarnings({
    baseWarnings: stats.warnings,
    incidents,
    config,
  });
  const mergedWarnings = mergePagerSweepWarnings(stats.warnings, escalation);

  return {
    policy,
    currentWarnings: filterPageableWarnings(mergedWarnings, policy),
    incidents,
    recentDeliveries,
    activeIncidentCount: incidents.filter((incident) => incident.status === INCIDENT_STATUS_ACTIVE).length,
    stats: {
      ...stats,
      warnings: mergedWarnings,
    },
  };
}

function summarizePagerAction(action = {}, delivery = null) {
  return {
    incidentCode: action.incidentCode,
    severity: action.severity,
    count: action.count,
    eventType: action.eventType,
    shouldNotify: Boolean(action.shouldNotify),
    nextStatus: action.nextStatus,
    deliveryStatus: delivery?.status || null,
    deliveryError: delivery?.error?.message || null,
    message: action.message,
  };
}

async function runPagerSweep({
  config = {},
  warningOverrides = null,
  dryRun = false,
} = {}) {
  const policy = buildPagerPolicy(config);
  const stats = await getQueueStats(getQueueStatsOptsFromConfig(config));

  if (dryRun) {
    const incidents = await listPagerIncidents({ includeResolved: true, limit: 50 });
    const warnings = warningOverrides
      ? normalizePagerWarningOverrides(warningOverrides)
      : mergePagerSweepWarnings(
          stats.warnings,
          buildIncidentEscalationWarnings({
            baseWarnings: stats.warnings,
            incidents,
            config,
          })
        );
    const plan = planPagerActions({
      warnings,
      incidents,
      policy,
    });

    return {
      ok: true,
      dryRun: true,
      policy,
      currentWarnings: plan.activeWarnings,
      actions: plan.actions.map((action) => summarizePagerAction(action)),
      incidents,
      recentDeliveries: await listPagerDeliveries({ limit: 20 }),
      stats: {
        ...stats,
        warnings,
      },
    };
  }

  const lockedResult = await withPagerLock(async (client) => {
    const incidents = await listPagerIncidents({
      executor: client,
      includeResolved: true,
      limit: 50,
    });
    const warnings = warningOverrides
      ? normalizePagerWarningOverrides(warningOverrides)
      : mergePagerSweepWarnings(
          stats.warnings,
          buildIncidentEscalationWarnings({
            baseWarnings: stats.warnings,
            incidents,
            config,
          })
        );
    const plan = planPagerActions({
      warnings,
      incidents,
      policy,
    });
    const actionSummaries = [];

    for (const action of plan.actions) {
      const incident = await savePagerIncident(client, action, plan.now);
      let delivery = null;

      if (action.shouldNotify && policy.deliveryTargetConfigured) {
        const payload = buildPagerWebhookPayload({
          action: {
            ...action,
            now: plan.now,
          },
          policy,
        });

        try {
          const response = await sendPagerDiscordWebhook(config.opsPagerDiscordWebhookUrl, payload);
          delivery = {
            status: "sent",
            eventType: action.eventType,
            deliveryTarget: "discord_webhook",
            payload,
            response,
            error: null,
          };
          await recordPagerDelivery(client, incident, action, delivery);
          await updateIncidentAfterDelivery(client, incident.incident_id, delivery, plan.now);
        } catch (error) {
          delivery = {
            status: "failed",
            eventType: action.eventType,
            deliveryTarget: "discord_webhook",
            payload,
            response: null,
            error: {
              message: error?.message || String(error),
            },
          };
          await recordPagerDelivery(client, incident, action, delivery);
          await updateIncidentAfterDelivery(client, incident.incident_id, delivery, plan.now);
        }
      }

      actionSummaries.push(summarizePagerAction(action, delivery));
    }

    return {
      locked: true,
      policy,
      currentWarnings: plan.activeWarnings,
      actions: actionSummaries,
      incidents: await listPagerIncidents({
        executor: client,
        includeResolved: true,
        limit: 50,
      }),
      recentDeliveries: await listPagerDeliveries({
        executor: client,
        limit: 20,
      }),
      stats: {
        ...stats,
        warnings,
      },
    };
  });

  if (!lockedResult?.locked) {
    const incidents = await listPagerIncidents({ includeResolved: true, limit: 50 });
    const mergedWhenSkipped = warningOverrides
      ? normalizePagerWarningOverrides(warningOverrides)
      : mergePagerSweepWarnings(
          stats.warnings,
          buildIncidentEscalationWarnings({
            baseWarnings: stats.warnings,
            incidents,
            config,
          })
        );
    return {
      ok: true,
      locked: false,
      skipped: true,
      reason: "pager_locked",
      policy,
      currentWarnings: filterPageableWarnings(mergedWhenSkipped, policy),
      actions: [],
      incidents,
      recentDeliveries: await listPagerDeliveries({ limit: 20 }),
      stats: {
        ...stats,
        warnings: mergedWhenSkipped,
      },
    };
  }

  return {
    ok: true,
    ...lockedResult,
  };
}

module.exports = {
  buildIncidentEscalationWarnings,
  buildPagerPolicy,
  buildPagerWebhookPayload,
  ensurePagerSchema,
  getPagerStatus,
  mergePagerSweepWarnings,
  normalizePagerSeverity,
  normalizePagerWarningOverrides,
  planPagerActions,
  runPagerSweep,
};
