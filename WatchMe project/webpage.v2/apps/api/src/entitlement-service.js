function normalizeStatus(value) {
  return String(value || "none").trim().toUpperCase();
}

export function resolveEntitlement({
  billingStatus = "none",
  manualPro = false,
  tester = false,
} = {}) {
  if (manualPro) {
    return {
      tier: "pro",
      active: true,
      status: "MANUAL",
      source: "manual",
      reason: "manual-allow-list",
    };
  }

  if (tester) {
    return {
      tier: "pro",
      active: true,
      status: "TESTER",
      source: "tester",
      reason: "tester-access",
    };
  }

  const normalized = normalizeStatus(billingStatus);
  if (normalized === "ACTIVE") {
    return {
      tier: "pro",
      active: true,
      status: normalized,
      source: "billing",
      reason: "active-subscription",
    };
  }

  return {
    tier: "lite",
    active: false,
    status: normalized,
    source: normalized === "NONE" ? "none" : "billing",
    reason: normalized === "APPROVAL_PENDING" ? "pending-does-not-unlock-pro" : "not-pro",
  };
}

