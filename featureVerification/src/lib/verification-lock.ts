export const VERIFICATION_LOCK_SCOPE = 'judgement' as const
export const VERIFICATION_LOCK_TTL_MS = 90_000
export const VERIFICATION_LOCK_HEARTBEAT_MS = 60_000

export type VerificationLockState = {
  isLocked: boolean
  isHeldByMe: boolean
  scopeKey: string
  lockedByName?: string
  lockedByUsername?: string
  expiresAt?: string
}
