import {
  DR_CLI_JSON_SCHEMA_VERSION,
  emitJson,
} from "./json-mode";

export type JsonEnvelopeV1Payload = {
  ok: boolean;
  command: string;
  contract: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  halt?: Record<string, unknown> | null;
};

export function emitJsonV1(payload: JsonEnvelopeV1Payload): void {
  emitJson({
    schema_version: DR_CLI_JSON_SCHEMA_VERSION,
    ...payload,
  });
}
