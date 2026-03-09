export type UnknownRecord = Record<string, unknown>

export function isObjectRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function asRecord(value: unknown): UnknownRecord | undefined {
  return isObjectRecord(value) ? value : undefined
}

export function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

export function asString(
  value: unknown,
  options?: { allowEmpty?: boolean }
): string | undefined {
  if (typeof value === 'string') {
    const normalized = value.trim()
    if (!options?.allowEmpty && normalized.length === 0) {
      return undefined
    }

    return normalized
  }

  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString()
  }

  return undefined
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.trim()
    if (normalized.length === 0) {
      return undefined
    }

    const parsed = Number(normalized.replace(/,/g, ''))
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

export function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    if (value === 1) {
      return true
    }

    if (value === 0) {
      return false
    }
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true
    }

    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false
    }
  }

  return undefined
}

export function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const normalized = value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => typeof entry === 'string')

  return normalized.length > 0 ? normalized : undefined
}
