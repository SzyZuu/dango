import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'

export class HttpError extends Error {
  status: number

  constructor(status: number, message?: string) {
    super(message || `Upstream request failed with status ${status}`)
    this.name = 'HttpError'
    this.status = status
  }
}

export function decodeMaybeGzip(bytes: Buffer): Buffer {
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return gunzipSync(bytes)
  return bytes
}

export async function parseJsonBody<T = unknown>(res: Response): Promise<T> {
  const buf = Buffer.from(await res.arrayBuffer())
  const text = decodeMaybeGzip(buf).toString('utf8')
  try {
    return JSON.parse(text) as T
  } catch (err) {
    const attempts: Array<() => Buffer> = [() => brotliDecompressSync(buf), () => inflateSync(buf)]
    for (const attempt of attempts) {
      try {
        return JSON.parse(attempt().toString('utf8')) as T
      } catch {
        // ignore
      }
    }
    throw err
  }
}

export function linkAbort(signal: AbortSignal, abort: AbortController): void {
  signal.addEventListener('abort', () => abort.abort(), { once: true })
}

export function setProxyHeaders(
  out: Headers,
  get: (name: string) => string | string[] | null | undefined
): void {
  for (const name of ['content-length', 'content-range', 'accept-ranges'] as const) {
    const raw = get(name)
    const value = Array.isArray(raw) ? raw[0] : raw
    if (value) out.set(name, value)
  }
  out.set('Access-Control-Allow-Origin', '*')
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: string }).name
  return name === 'AbortError' || name === 'TimeoutError'
}

// the retry policy for the upstream calls: got does the retrying, this says how much
export const UPSTREAM_RETRY = { limit: 2 }

export interface FetchRetryOptions {
  retries?: number
  baseDelayMs?: number
  timeoutMs?: number
  signal?: AbortSignal
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

// the one retry: the attempt returns null when it wants another try
export async function withRetry<T>(
  attempt: (attempt: number) => Promise<T | null>,
  options: { retries?: number; baseDelayMs?: number; signal?: AbortSignal } = {}
): Promise<T | null> {
  const { retries = 2, baseDelayMs = 400, signal } = options
  let last: T | null = null
  for (let i = 0; i <= retries; i++) {
    if (signal?.aborted) break
    last = await attempt(i)
    if (last !== null) return last
    if (i < retries) await sleep(Math.min(baseDelayMs * (i + 1), 3000))
  }
  return last
}

export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit = {},
  options: FetchRetryOptions = {}
): Promise<Response> {
  const { retries = 0, baseDelayMs = 100, timeoutMs = 30000, signal } = options
  let last: Response | null = null
  let lastError: unknown = null
  const response = await withRetry<Response>(
    async (attempt) => {
      const timeoutSignal = AbortSignal.timeout(timeoutMs)
      const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
      try {
        const res = await fetch(input, { ...init, signal: combined })
        last = res
        if (!isRetryableStatus(res.status) || attempt >= retries) return res
        try {
          await res.body?.cancel()
        } catch {
          // ignore
        }
        return null
      } catch (err) {
        if (signal?.aborted) throw err
        if (!isAbortError(err) && !(err instanceof TypeError)) throw err
        lastError = err
        return null
      }
    },
    { retries, baseDelayMs, signal }
  )
  if (response) return response
  if (last) return last
  throw lastError ?? new HttpError(0, 'The upstream request failed')
}
