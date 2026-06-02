const STUDENT_IDENTITY_STORAGE_KEY = 'verification-student-identity'
const LOCK_TOKEN_STORAGE_KEY = 'verification-lock-token'

function getWindowStorage() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage
}

function getSessionStorage() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.sessionStorage
}

function createLockToken() {
  if (typeof window !== 'undefined') {
    try {
      return window.crypto.randomUUID()
    } catch {
      return `${Date.now()}-${Math.random()}`
    }
  }

  return `${Date.now()}-${Math.random()}`
}

export function getStoredStudentIdentity() {
  return getWindowStorage()?.getItem(STUDENT_IDENTITY_STORAGE_KEY) ?? ''
}

export function setStoredStudentIdentity(value: string) {
  getWindowStorage()?.setItem(STUDENT_IDENTITY_STORAGE_KEY, value.trim())
}

export function getOrCreateLockToken() {
  const storage = getSessionStorage()

  if (!storage) {
    return createLockToken()
  }

  const existingToken = storage.getItem(LOCK_TOKEN_STORAGE_KEY)
  if (existingToken) {
    return existingToken
  }

  const nextToken = createLockToken()
  storage.setItem(LOCK_TOKEN_STORAGE_KEY, nextToken)
  return nextToken
}

export function clearLockToken() {
  getSessionStorage()?.removeItem(LOCK_TOKEN_STORAGE_KEY)
}
