import { randomBytes, createHash } from 'node:crypto'

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function mintToken({ sandboxId, ttlMs, now }) {
  const token = randomBytes(32).toString('hex')
  const record = {
    sandboxId,
    tokenHash: hashToken(token),
    expiresAt: now + ttlMs,
  }
  return { token, record }
}

export function verifyToken(token, records, now) {
  const tokenHash = hashToken(token)
  for (const record of records) {
    if (record.tokenHash === tokenHash) {
      if (now >= record.expiresAt) return null
      return { sandboxId: record.sandboxId }
    }
  }
  return null
}
