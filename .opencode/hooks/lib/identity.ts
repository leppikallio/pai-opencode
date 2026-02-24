import { existsSync, readFileSync } from "node:fs";

import { paiPath } from "./paths";

type JsonRecord = Record<string, unknown>;

export interface DAIdentity {
  name: string;
  fullName: string;
  displayName: string;
  voiceId: string;
}

export interface PrincipalIdentity {
  name: string;
  pronunciation: string;
  timezone: string;
}

interface HookSettings {
  daidentity?: Record<string, unknown>;
  principal?: Record<string, unknown>;
  env?: Record<string, unknown>;
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function loadSettings(): HookSettings {
  const settingsPath = paiPath("settings.json");
  if (!existsSync(settingsPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
    return (asRecord(parsed) as HookSettings | null) ?? {};
  } catch {
    return {};
  }
}

export function getIdentity(): DAIdentity {
  const settings = loadSettings();
  const daidentity = asRecord(settings.daidentity) ?? {};
  const env = asRecord(settings.env) ?? {};
  const envDa = asString(env.DA) ?? asString(process.env.DA);

  const name = asString(daidentity.name) ?? envDa ?? "PAI";

  return {
    name,
    fullName: asString(daidentity.fullName) ?? name,
    displayName: asString(daidentity.displayName) ?? name,
    voiceId: asString(daidentity.voiceId) ?? asString(process.env.DA_VOICE_ID) ?? "",
  };
}

export function getPrincipal(): PrincipalIdentity {
  const settings = loadSettings();
  const principal = asRecord(settings.principal) ?? {};
  const env = asRecord(settings.env) ?? {};

  return {
    name: asString(principal.name) ?? asString(env.PRINCIPAL) ?? asString(process.env.PRINCIPAL) ?? "User",
    pronunciation: asString(principal.pronunciation) ?? "",
    timezone:
      asString(principal.timezone) ??
      asString(process.env.PRINCIPAL_TIMEZONE) ??
      asString(process.env.TZ) ??
      "UTC",
  };
}

export function getDAName(): string {
  return getIdentity().name;
}

export function getPrincipalName(): string {
  return getPrincipal().name;
}

export function getVoiceId(): string {
  return getIdentity().voiceId;
}
