'use strict';
/**
 * MESH — Deployments and Policy Layer
 * Deployment queuing, settlement, policy creation and updates.
 *
 * All functions reference globals (populated by server.js at startup) at
 * call-time. No Node.js built-ins are needed directly.
 */

function normalizeDeploymentRisk(value) {
  const normalized = String(value || "low").trim().toLowerCase();
  if (["low", "moderate", "high"].includes(normalized)) return normalized;
  return "low";
}

function normalizePolicyMode(value) {
  const normalized = String(value || "manual").trim().toLowerCase();
  if (["auto", "manual", "enforced", "disabled"].includes(normalized)) return normalized;
  return "manual";
}

function normalizePolicyStatus(value) {
  const normalized = String(value || "active").trim().toLowerCase();
  if (["active", "review", "disabled"].includes(normalized)) return normalized;
  return "active";
}

function normalizePolicyRegion(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["eu", "us", "ap", "global"].includes(normalized)) return normalized;
  return "";
}

function parsePolicyScopeFromPayload(payload = {}, fallback = {}) {
  const fallbackRoute = String(fallback?.route || "workspace").trim() || "workspace";
  const fallbackRegion = normalizePolicyRegion(fallback?.region) || "global";

  const directRoute = String(payload?.route || "").trim();
  const directRegion = normalizePolicyRegion(payload?.region);
  if (directRoute || directRegion) {
    return {
      route: directRoute || fallbackRoute,
      region: directRegion || fallbackRegion,
    };
  }

  const applied = String(payload?.applied || "").trim();
  if (!applied) {
    return {
      route: fallbackRoute,
      region: fallbackRegion,
    };
  }

  const parts = applied.split(",").map((item) => item.trim()).filter(Boolean);
  const route = String(parts[0] || fallbackRoute).trim() || fallbackRoute;
  const region = normalizePolicyRegion(parts[1]) || fallbackRegion;
  return { route, region };
}

function stringifyPolicyScope(route, region) {
  const normalizedRoute = String(route || "workspace").trim() || "workspace";
  const normalizedRegion = normalizePolicyRegion(region) || "global";
  return `${normalizedRoute}, ${normalizedRegion}`;
}

function uniqueDeploymentId(baseId) {
  let id = toSafeSlug(baseId, "deploy");
  const exists = (candidate) =>
    operationsStore.deployments.pending.some((item) => item.id === candidate) ||
    operationsStore.deployments.history.some((item) => item.id === candidate);

  if (!exists(id)) return id;
  let count = 2;
  while (exists(`${id}-${count}`)) count += 1;
  return `${id}-${count}`;
}

function queueDeployment(payload = {}, user = {}) {
  const route = String(payload.route || payload.target || "workspace").trim() || "workspace";
  const title = String(payload.title || `Update ${route}`).trim() || `Update ${route}`;
  const id = uniqueDeploymentId(payload.id || `${route}-${title}`);

  const entry = {
    id,
    route,
    region: String(payload.region || "EU Central").trim() || "EU Central",
    title,
    risk: normalizeDeploymentRisk(payload.risk),
    description: String(payload.description || "No deployment description provided.").trim(),
    targetWindow: String(payload.targetWindow || "Immediate").trim() || "Immediate",
    rollback: String(payload.rollback || "Manual rollback").trim() || "Manual rollback",
    diff: String(payload.diff || "").trim(),
    requestedBy: String(payload.requestedBy || user?.name || user?.email || "operator").trim() || "operator",
    requestedAt: toIsoNow(),
  };

  operationsStore.deployments.pending.unshift(entry);
  operationsStore.deployments.pending = operationsStore.deployments.pending.slice(0, 120);
  appendOperationLog("info", `Deployment queued: ${entry.title}`, {
    region: inferRegionFromRouteName(entry.route),
    source: entry.requestedBy,
  });
  return entry;
}

function settleDeploymentAction(deploymentId, action, user = {}) {
  const id = toSafeSlug(deploymentId, "");
  const idx = operationsStore.deployments.pending.findIndex((item) => item.id === id);
  if (idx < 0) return null;

  const pending = operationsStore.deployments.pending.splice(idx, 1)[0];
  const outcome = action === "approve" ? "approved" : "rejected";
  const resolvedBy = String(user?.name || user?.email || "operator").trim() || "operator";
  const settledAt = toIsoNow();
  const settled = {
    ...pending,
    status: outcome,
    outcome,
    actedBy: resolvedBy,
    actedAt: settledAt,
    resolvedBy,
    resolvedAt: settledAt,
  };

  operationsStore.deployments.history.unshift(settled);
  operationsStore.deployments.history = operationsStore.deployments.history.slice(0, 300);
  appendOperationLog(outcome === "approved" ? "ok" : "warn", `Deployment ${outcome}: ${pending.title}`, {
    region: inferRegionFromRouteName(pending.route),
    source: resolvedBy,
  });
  return settled;
}

function uniquePolicyId(baseId) {
  const base = toSafeSlug(baseId, "policy");
  if (!operationsStore.policies.some((policy) => policy.id === base)) return base;

  let count = 2;
  while (operationsStore.policies.some((policy) => policy.id === `${base}-${count}`)) count += 1;
  return `${base}-${count}`;
}

function createPolicy(payload = {}, user = {}) {
  const type = String(payload.type || "Custom").trim() || "Custom";
  const scope = parsePolicyScopeFromPayload(payload, {
    route: "workspace",
    region: "global",
  });
  const id = uniquePolicyId(payload.id || payload.title || `${scope.route}-${type}`);
  const entry = {
    id,
    type,
    mode: normalizePolicyMode(payload.mode),
    route: scope.route,
    region: scope.region,
    applied: stringifyPolicyScope(scope.route, scope.region),
    status: normalizePolicyStatus(payload.status),
    description: String(payload.description || "").trim(),
    modifiedAt: toIsoNow(),
  };

  operationsStore.policies.unshift(entry);
  operationsStore.policies = operationsStore.policies.slice(0, 200);
  appendOperationLog("info", `Policy created: ${entry.id}`, {
    region: inferRegionFromRouteName(entry.applied),
    source: String(user?.name || user?.email || "operator"),
  });
  return entry;
}

function updatePolicy(policyId, payload = {}, user = {}) {
  const id = toSafeSlug(policyId, "");
  const policy = operationsStore.policies.find((item) => item.id === id);
  if (!policy) return null;

  policy.type = String(payload.type || policy.type || "Custom").trim() || "Custom";
  policy.mode = normalizePolicyMode(payload.mode || policy.mode);
  const scope = parsePolicyScopeFromPayload(payload, {
    route: policy.route || "workspace",
    region: policy.region || "global",
  });
  policy.route = scope.route;
  policy.region = scope.region;
  policy.applied = stringifyPolicyScope(scope.route, scope.region);
  policy.status = normalizePolicyStatus(payload.status || policy.status);
  policy.description = String(payload.description || policy.description || "").trim();
  policy.modifiedAt = toIsoNow();

  appendOperationLog("info", `Policy updated: ${policy.id}`, {
    region: inferRegionFromRouteName(policy.applied),
    source: String(user?.name || user?.email || "operator"),
  });
  return policy;
}

module.exports = {
  normalizeDeploymentRisk,
  normalizePolicyMode,
  normalizePolicyStatus,
  normalizePolicyRegion,
  parsePolicyScopeFromPayload,
  stringifyPolicyScope,
  uniqueDeploymentId,
  queueDeployment,
  settleDeploymentAction,
  uniquePolicyId,
  createPolicy,
  updatePolicy,
};
