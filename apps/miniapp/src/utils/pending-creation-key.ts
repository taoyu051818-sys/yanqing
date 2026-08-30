interface PendingCreationRecord {
  key: string
  fingerprint: string
  actorScope: string
  createdAt: number
}

const STORAGE_PREFIX = 'yanqing:pending-creation:'

function normalize(value: unknown, inArray = false): unknown {
  if (value === undefined) return inArray ? null : undefined
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((item) => normalize(item, true))
  if (typeof value === 'object') {
    const normalized: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = normalize((value as Record<string, unknown>)[key])
      if (item !== undefined) normalized[key] = item
    }
    return normalized
  }
  return String(value)
}

export function creationCommandFingerprint(command: unknown): string {
  return JSON.stringify(normalize(command))
}

function storageKey(slot: string): string {
  if (!slot.trim()) throw new Error('pending creation slot is required')
  return `${STORAGE_PREFIX}${slot}`
}

function compactHash(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

function currentActorScope(): string {
  const actorId = uni.getStorageSync('yanqing_actor_id')
  if (typeof actorId === 'string' && actorId) return `user:${actorId}`
  const token = uni.getStorageSync('yanqing_access_token')
  return typeof token === 'string' && token ? `token:${compactHash(token)}` : 'anonymous'
}

function read(slot: string): PendingCreationRecord | null {
  const value = uni.getStorageSync(storageKey(slot)) as Partial<PendingCreationRecord> | null
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.key !== 'string' ||
    typeof value.fingerprint !== 'string' ||
    typeof value.actorScope !== 'string' ||
    typeof value.createdAt !== 'number'
  ) return null
  return value as PendingCreationRecord
}

function createKey(): string {
  const random = () => Math.random().toString(36).slice(2, 12).padEnd(10, '0')
  return `create-${Date.now().toString(36)}-${random()}-${random()}`
}

/**
 * Returns the pending key for one logical creation command. A retry (including
 * after an app restart) reuses the key; changing the command replaces it.
 */
export function getPendingCreationKey(slot: string, command: unknown): string {
  const fingerprint = creationCommandFingerprint(command)
  const actorScope = currentActorScope()
  const existing = read(slot)
  if (existing?.fingerprint === fingerprint && existing.actorScope === actorScope) return existing.key

  const record: PendingCreationRecord = {
    key: createKey(),
    fingerprint,
    actorScope,
    createdAt: Date.now(),
  }
  uni.setStorageSync(storageKey(slot), record)
  return record.key
}

/** Clears only the command that actually completed, never a newer command. */
export function completePendingCreation(slot: string, command: unknown, key: string): void {
  const existing = read(slot)
  if (
    existing?.key === key &&
    existing.actorScope === currentActorScope() &&
    existing.fingerprint === creationCommandFingerprint(command)
  ) {
    uni.removeStorageSync(storageKey(slot))
  }
}

export async function withPendingCreationKey<T>(
  slot: string,
  command: unknown,
  send: (creationIdempotencyKey: string) => Promise<T>,
): Promise<T> {
  const key = getPendingCreationKey(slot, command)
  const result = await send(key)
  completePendingCreation(slot, command, key)
  return result
}
