/**
 * event-normalize.ts
 *
 * Small helpers to tolerate minor OpenCode event payload shape drift.
 */

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

export function getRecordProp(obj: unknown, key: string): UnknownRecord | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  return isRecord(v) ? v : undefined;
}

export function getStringProp(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

export function getSessionStatusType(eventObj: unknown): string {
  const props = getRecordProp(eventObj, "properties") ?? {};
  const status = getRecordProp(props, "status");
  const typeFromProps = (getStringProp(status, "type") ?? "").trim();
  if (typeFromProps) return typeFromProps.toLowerCase();

  const data = (isRecord(eventObj) ? eventObj["data"] : undefined) as unknown;
  const dataRec = isRecord(data) ? data : undefined;
  const typeFromData = String(
    (dataRec ? (dataRec["status"] ?? dataRec["state"] ?? dataRec["phase"]) : "") ?? ""
  ).trim();
  if (typeFromData) return typeFromData.toLowerCase();

  try {
    const blob = JSON.stringify({ props, data: dataRec ?? data });
    if (blob.toLowerCase().includes("\"idle\"")) return "idle";
  } catch {
    // ignore
  }

  return "";
}

export function getPermissionRequestId(props: UnknownRecord): string {
  return (
    (typeof props.requestID === "string" ? props.requestID : "") ||
    (typeof props.requestId === "string" ? props.requestId : "") ||
    (typeof props.id === "string" ? props.id : "")
  );
}
