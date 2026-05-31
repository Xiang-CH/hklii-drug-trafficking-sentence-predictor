import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { VerificationLockState } from '@/lib/verification-lock'
import {
  acquireJudgementLock,
  releaseJudgementLock,
  renewJudgementLock,
} from '@/server/user-judgements'
import { VERIFICATION_LOCK_HEARTBEAT_MS } from '@/lib/verification-lock'
import {
  getOrCreateLockToken,
  getStoredStudentIdentity,
  setStoredStudentIdentity,
} from '@/lib/verification-session'

type UseVerificationLockOptions = {
  judgementId: string
  initialLockState: VerificationLockState
  sessionUserName?: string | null
}

export function useVerificationLock({
  judgementId,
  initialLockState,
  sessionUserName,
}: UseVerificationLockOptions) {
  const lockToken = useMemo(() => getOrCreateLockToken(), [])
  const [studentIdentity, setStudentIdentity] = useState(() => {
    return getStoredStudentIdentity() || sessionUserName?.trim() || ''
  })
  const [lockState, setLockState] = useState(initialLockState)
  const [isLockActionPending, setIsLockActionPending] = useState(false)
  const releaseRequestedRef = useRef(false)
  const restoreAttemptedRef = useRef<string | null>(null)

  useEffect(() => {
    setStoredStudentIdentity(studentIdentity)
  }, [studentIdentity])

  useEffect(() => {
    if (releaseRequestedRef.current) {
      return
    }

    if (lockState.isHeldByMe) {
      return
    }

    setLockState(initialLockState)
  }, [initialLockState, lockState.isHeldByMe])

  useEffect(() => {
    releaseRequestedRef.current = false
    restoreAttemptedRef.current = null
  }, [judgementId])

  const acquireLock = useCallback(
    async (showError = true) => {
      if (!judgementId) {
        return null
      }

      if (!studentIdentity.trim()) {
        if (showError) {
          toast.error('Enter a student identity before acquiring a lock')
        }
        return null
      }

      releaseRequestedRef.current = false
      setIsLockActionPending(true)
      try {
        const nextLockState = await acquireJudgementLock({
          data: {
            judgementId,
            lockToken,
            holderName: studentIdentity.trim(),
          },
        })
        setLockState(nextLockState)
        return nextLockState
      } catch (error) {
        if (showError) {
          toast.error('Failed to acquire lock', {
            description:
              error instanceof Error ? error.message : 'Unknown error',
          })
        }
        throw error
      } finally {
        setIsLockActionPending(false)
      }
    },
    [judgementId, lockToken, studentIdentity],
  )

  const renewLock = useCallback(async () => {
    if (!judgementId) {
      return null
    }

    if (!studentIdentity.trim()) {
      return null
    }

    const nextLockState = await renewJudgementLock({
      data: {
        judgementId,
        lockToken,
        holderName: studentIdentity.trim(),
      },
    })

    if (!releaseRequestedRef.current) {
      setLockState(nextLockState)
    }

    return nextLockState
  }, [judgementId, lockToken, studentIdentity])

  const releaseLock = useCallback(
    async (showError = true) => {
      if (!judgementId) {
        return null
      }

      releaseRequestedRef.current = true
      setIsLockActionPending(true)
      try {
        await releaseJudgementLock({
          data: {
            judgementId,
            lockToken,
          },
        })
        setLockState({
          isLocked: false,
          isHeldByMe: false,
          scopeKey: initialLockState.scopeKey,
        })
      } catch (error) {
        releaseRequestedRef.current = false
        if (showError) {
          toast.error('Failed to release lock', {
            description:
              error instanceof Error ? error.message : 'Unknown error',
          })
        }
        throw error
      } finally {
        setIsLockActionPending(false)
      }
    },
    [initialLockState.scopeKey, judgementId, lockToken],
  )

  useEffect(() => {
    if (!judgementId) {
      return
    }

    if (!initialLockState.isLocked || lockState.isHeldByMe) {
      return
    }

    if (!studentIdentity.trim()) {
      return
    }

    if (releaseRequestedRef.current) {
      return
    }

    if (restoreAttemptedRef.current === judgementId) {
      return
    }

    restoreAttemptedRef.current = judgementId

    void renewLock().catch(() => undefined)
  }, [
    initialLockState.isLocked,
    judgementId,
    lockState.isHeldByMe,
    renewLock,
    studentIdentity,
  ])

  useEffect(() => {
    if (!judgementId) {
      return
    }

    if (!lockState.isHeldByMe) {
      return
    }

    const heartbeat = window.setInterval(() => {
      void renewLock().catch(() => {
        if (releaseRequestedRef.current) {
          return
        }

        setLockState((current) => ({
          ...current,
          isHeldByMe: false,
          isLocked: false,
        }))
        toast.error('Edit lock expired')
      })
    }, VERIFICATION_LOCK_HEARTBEAT_MS)

    return () => window.clearInterval(heartbeat)
  }, [judgementId, lockState.isHeldByMe, renewLock])

  return {
    studentIdentity,
    setStudentIdentity,
    lockState,
    canEdit: lockState.isHeldByMe,
    isLockActionPending,
    acquireLock,
    releaseLock,
    lockToken,
  }
}
