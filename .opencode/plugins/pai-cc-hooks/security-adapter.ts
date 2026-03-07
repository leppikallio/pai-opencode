import type { SecurityResult } from "../adapters/types";
import {
  createSecurityPermissionDecisionFromError,
  createSecurityPermissionDecisionFromResult,
  type SecurityPermissionDecision,
} from "../security/adapter-decision";
import type { PermissionDecision } from "./claude/types";

export type PreToolSecurityDecision = {
  decision: PermissionDecision;
  reason?: string;
};

function mapPermissionStatusToDecision(
  status: SecurityPermissionDecision["status"],
): PermissionDecision {
  if (status === "ask") {
    return "ask";
  }

  if (status === "deny") {
    return "deny";
  }

  return "allow";
}

function toPreToolSecurityDecision(
  decision: SecurityPermissionDecision,
): PreToolSecurityDecision {
  return {
    decision: mapPermissionStatusToDecision(decision.status),
    reason: decision.reason,
  };
}

export function createPreToolSecurityDecisionFromResult(
  result: SecurityResult,
): PreToolSecurityDecision {
  return toPreToolSecurityDecision(createSecurityPermissionDecisionFromResult(result));
}

export function createPreToolSecurityDecisionFromError(
  error: unknown,
): PreToolSecurityDecision {
  return toPreToolSecurityDecision(createSecurityPermissionDecisionFromError(error));
}
