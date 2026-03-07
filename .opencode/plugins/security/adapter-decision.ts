import type { SecurityResult } from "../adapters/types";

export type SecurityPermissionStatus = "allow" | "ask" | "deny";

export type SecurityPermissionDecision = {
  status: SecurityPermissionStatus;
  reason?: string;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return String(error);
}

export function mapSecurityActionToPermissionStatus(
  action: SecurityResult["action"],
): SecurityPermissionStatus {
  if (action === "block") {
    return "deny";
  }

  if (action === "confirm") {
    return "ask";
  }

  return "allow";
}

export function mapSecurityResultToPermissionStatus(result: SecurityResult): SecurityPermissionStatus {
  return mapSecurityActionToPermissionStatus(result.action);
}

export function createSecurityPermissionAskFallback(error: unknown): {
  status: "ask";
  reason: string;
} {
  return {
    status: "ask",
    reason: `Security validator error: ${toErrorMessage(error)}`,
  };
}

export function createSecurityPermissionDecisionFromResult(
  result: SecurityResult,
): SecurityPermissionDecision {
  const status = mapSecurityResultToPermissionStatus(result);

  if (status === "allow") {
    return { status };
  }

  return {
    status,
    reason: result.message ?? result.reason,
  };
}

export function createSecurityPermissionDecisionFromError(error: unknown): {
  status: "ask";
  reason: string;
} {
  return createSecurityPermissionAskFallback(error);
}
