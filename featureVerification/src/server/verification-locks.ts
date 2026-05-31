import { MongoServerError, ObjectId } from 'mongodb'
import type { VerificationLockState } from '@/lib/verification-lock'
import { db } from '@/lib/db'
import {
  VERIFICATION_LOCK_HEARTBEAT_MS,
  VERIFICATION_LOCK_SCOPE,
  VERIFICATION_LOCK_TTL_MS,
} from '@/lib/verification-lock'

type VerificationLockInput = {
  judgementId: string
  userId: string
  holderName: string
  holderUsername?: string | null
  lockToken: string
}

const lockCollection = () => db.collection('verification-locks')

let ensureIndexesPromise: Promise<void> | null = null

async function ensureLockIndexes() {
  if (!ensureIndexesPromise) {
    ensureIndexesPromise = (async () => {
      await lockCollection().createIndex(
        { source_judgement_id: 1, scope_key: 1 },
        { unique: true, name: 'verification_lock_unique_scope' },
      )
      await lockCollection().createIndex(
        { expires_at: 1 },
        { expireAfterSeconds: 0, name: 'verification_lock_expires' },
      )
    })()
  }

  await ensureIndexesPromise
}

function getLockExpiryDate(now = new Date()) {
  return new Date(now.getTime() + VERIFICATION_LOCK_TTL_MS)
}

function toLockState(
  lockDoc: {
    scope_key: string
    locked_by_name?: string
    locked_by_username?: string | null
    expires_at?: Date
  } | null,
  isHeldByMe: boolean,
): VerificationLockState {
  if (!lockDoc) {
    return {
      isLocked: false,
      isHeldByMe,
      scopeKey: VERIFICATION_LOCK_SCOPE,
    }
  }

  return {
    isLocked: true,
    isHeldByMe,
    scopeKey: lockDoc.scope_key,
    lockedByName: lockDoc.locked_by_name,
    lockedByUsername: lockDoc.locked_by_username ?? undefined,
    expiresAt: lockDoc.expires_at?.toISOString(),
  }
}

function isDuplicateKeyError(error: unknown) {
  return error instanceof MongoServerError && error.code === 11000
}

async function updateLockLease({
  judgementId,
  lockToken,
  holderName,
  holderUsername,
}: VerificationLockInput) {
  await ensureLockIndexes()

  const now = new Date()
  const filter = {
    source_judgement_id: new ObjectId(judgementId),
    scope_key: VERIFICATION_LOCK_SCOPE,
    $or: [
      { expires_at: { $lte: now } },
      { lock_token: lockToken },
      { lock_token: { $exists: false } },
    ],
  }

  try {
    await lockCollection().updateOne(
      filter,
      {
        $setOnInsert: {
          source_judgement_id: new ObjectId(judgementId),
          scope_key: VERIFICATION_LOCK_SCOPE,
          acquired_at: now,
        },
        $set: {
          lock_token: lockToken,
          locked_by_name: holderName,
          locked_by_username: holderUsername ?? null,
          updated_at: now,
          expires_at: getLockExpiryDate(now),
        },
      },
      { upsert: true },
    )
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new Error('This judgement is locked by another student')
    }
    throw error
  }

  const lockDoc = await lockCollection().findOne({
    source_judgement_id: new ObjectId(judgementId),
    scope_key: VERIFICATION_LOCK_SCOPE,
    lock_token: lockToken,
  })

  if (!lockDoc) {
    throw new Error('Failed to acquire edit lock')
  }

  return toLockState(lockDoc, true)
}

export async function getCurrentVerificationLock(judgementId: string) {
  await ensureLockIndexes()

  const lockDoc = await lockCollection().findOne({
    source_judgement_id: new ObjectId(judgementId),
    scope_key: VERIFICATION_LOCK_SCOPE,
    expires_at: { $gt: new Date() },
  })

  return toLockState(lockDoc, false)
}

export async function acquireVerificationLock(input: VerificationLockInput) {
  return await updateLockLease(input)
}

export async function renewVerificationLock(input: VerificationLockInput) {
  await ensureLockIndexes()

  const now = new Date()
  const result = await lockCollection().updateOne(
    {
      source_judgement_id: new ObjectId(input.judgementId),
      scope_key: VERIFICATION_LOCK_SCOPE,
      lock_token: input.lockToken,
      expires_at: { $gt: now },
    },
    {
      $set: {
        locked_by_name: input.holderName,
        locked_by_username: input.holderUsername ?? null,
        updated_at: now,
        expires_at: getLockExpiryDate(now),
      },
    },
  )

  if (result.matchedCount === 0) {
    throw new Error('Your edit lock expired or was taken by another student')
  }

  const lockDoc = await lockCollection().findOne({
    source_judgement_id: new ObjectId(input.judgementId),
    scope_key: VERIFICATION_LOCK_SCOPE,
    lock_token: input.lockToken,
  })

  if (!lockDoc) {
    throw new Error('Your edit lock expired or was taken by another student')
  }

  return toLockState(lockDoc, true)
}

export async function releaseVerificationLock({
  judgementId,
  lockToken,
}: Pick<VerificationLockInput, 'judgementId' | 'lockToken'>) {
  await ensureLockIndexes()

  await lockCollection().deleteOne({
    source_judgement_id: new ObjectId(judgementId),
    scope_key: VERIFICATION_LOCK_SCOPE,
    lock_token: lockToken,
  })

  return {
    success: true,
  }
}

export async function assertVerificationLockHeld({
  judgementId,
  lockToken,
  holderName,
  holderUsername,
}: VerificationLockInput) {
  const lockState = await renewVerificationLock({
    judgementId,
    lockToken,
    holderName,
    holderUsername,
  })

  return {
    lockState,
    heartbeatMs: VERIFICATION_LOCK_HEARTBEAT_MS,
  }
}
