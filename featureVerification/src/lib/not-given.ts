type NotGivenMap = Record<string, boolean>

function parsePath(path: string): Array<string | number> {
  const out: Array<string | number> = []
  const re = /([^[.\]]+)|\[(\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) out.push(m[1])
    else if (m[2] !== undefined) out.push(Number(m[2]))
  }
  return out
}

function setAtPath(obj: any, tokens: Array<string | number>, value: any) {
  let cur = obj
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i]
    if (cur == null) return
    cur = cur[t as any]
  }
  const last = tokens[tokens.length - 1]
  if (cur != null) cur[last as any] = value
}

export function applyNotGivenToPayload<T extends object>(
  payload: T,
  notGivenMap: NotGivenMap,
): T {
  const cloned: any =
    typeof structuredClone === 'function'
      ? structuredClone(payload)
      : JSON.parse(JSON.stringify(payload))

  for (const [path, isNotGiven] of Object.entries(notGivenMap)) {
    if (!isNotGiven) continue
    if (
      !(
        path.startsWith('judgement') ||
        path.startsWith('defendants') ||
        path.startsWith('trials')
      )
    ) {
      continue
    }
    const tokens = parsePath(path)
    if (tokens.length === 0) continue
    setAtPath(cloned, tokens, null)
  }

  return cloned
}