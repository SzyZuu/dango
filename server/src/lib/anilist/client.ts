import logger from '../../logger.js'
import { fetchWithRetry, parseJsonBody } from '../../utils/http.utils.js'

const ANILIST_API = 'https://graphql.anilist.co'

let anilistDownUntil = 0
let anilistRateLimited = false
let anilistWasDownAtBoot = false
const DOWN_COOLDOWN_MS = 10 * 60 * 1000
const NETWORK_COOLDOWN_MS = 2 * 60 * 1000
const RATE_LIMIT_FALLBACK_THRESHOLD_MS = 30 * 1000

export function anilistUnavailable(): boolean {
  if (anilistDownUntil > Date.now()) return true
  if (anilistRateLimited && anilistCooldownUntil - Date.now() > RATE_LIMIT_FALLBACK_THRESHOLD_MS) {
    return true
  }
  return false
}

export function isAnilistRateLimited(): boolean {
  return anilistRateLimited && anilistCooldownUntil > Date.now()
}

export async function checkAnilistStatus(): Promise<boolean> {
  const available = await performAnilistStatusCheck()
  if (!available) {
    anilistWasDownAtBoot = true
  }
  return available
}

async function performAnilistStatusCheck(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const response = await fetch(ANILIST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: 'query { __typename }' }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    const available = response.ok
    if (!available) {
      anilistDownUntil = Date.now() + DOWN_COOLDOWN_MS
      anilistRateLimited = false
    } else {
      anilistDownUntil = 0
      anilistRateLimited = false
    }
    return available
  } catch {
    anilistDownUntil = Date.now() + DOWN_COOLDOWN_MS
    anilistRateLimited = false
    return false
  }
}

export function wasAnilistDownAtBoot(): boolean {
  return anilistWasDownAtBoot
}

const BURST_CAPACITY = 8
const DEFAULT_REFILL_INTERVAL_MS = 1500
let refillIntervalMs = DEFAULT_REFILL_INTERVAL_MS
let tokens = BURST_CAPACITY
let lastRefill = Date.now()
let anilistCooldownUntil = 0

function refillTokens(): void {
  const now = Date.now()
  if (now < lastRefill) return
  const elapsed = now - lastRefill
  const refillAmount = Math.floor(elapsed / refillIntervalMs)
  if (refillAmount > 0) {
    tokens = Math.min(BURST_CAPACITY, tokens + refillAmount)
    lastRefill += refillAmount * refillIntervalMs
  }
}

export function applyRateLimitHeaders(headers: Headers): void {
  const readHeader = (name: string): number | null => {
    const raw = headers.get(name)
    if (raw === null || raw === '') return null
    const value = Number.parseInt(raw as string, 10)
    return Number.isFinite(value) && value >= 0 ? value : null
  }

  const limit = readHeader('X-RateLimit-Limit')
  const remaining = readHeader('X-RateLimit-Remaining')

  if (limit !== null && limit > 0) {
    const reserve = Math.max(1, Math.round(limit * 0.2))
    const safeRate = Math.max(1, limit - reserve)
    refillIntervalMs = Math.max(300, Math.min(60000, Math.round(60000 / safeRate)))
  }

  if (remaining !== null && remaining <= 2) {
    const reset = readHeader('X-RateLimit-Reset')
    if (reset !== null) {
      const resetMs = reset * 1000
      if (resetMs > Date.now()) {
        anilistCooldownUntil = Math.max(anilistCooldownUntil, resetMs)
      }
    }
  }
}

const anilistMemoryCache = new Map<string, { data: unknown; expiry: number }>()
const ANILIST_MEMORY_TTL = 60 * 60 * 1000
const airedEpisodesCache = new Map<string, { data: unknown; expiry: number }>()
const AIRED_EPISODES_TTL = 60 * 60 * 1000
export type AnilistResponse<T> = { data: T | null; errors?: { message: string }[] } | null
const inFlightAnilistRequests = new Map<string, Promise<AnilistResponse<unknown>>>()

function getAnilistCacheKey(query: string, variables?: Record<string, unknown>): string {
  return `${query}:${JSON.stringify(variables || {})}`
}

export function getCachedAnilist<T>(key: string): T | null {
  const entry = anilistMemoryCache.get(key)
  if (entry && Date.now() < entry.expiry) return entry.data as T
  anilistMemoryCache.delete(key)
  return null
}

export function setCachedAnilist(key: string, data: unknown): void {
  anilistMemoryCache.set(key, { data, expiry: Date.now() + ANILIST_MEMORY_TTL })
}

export function getCachedAiredEpisodes(
  key: string
): { mediaId: number; episode: number; airingAt: number }[] | null {
  const entry = airedEpisodesCache.get(key)
  if (entry && Date.now() < entry.expiry)
    return entry.data as { mediaId: number; episode: number; airingAt: number }[]
  airedEpisodesCache.delete(key)
  return null
}

export function setCachedAiredEpisodes(key: string, data: unknown): void {
  airedEpisodesCache.set(key, { data, expiry: Date.now() + AIRED_EPISODES_TTL })
}

export async function waitForAnilistSlot(): Promise<void> {
  while (true) {
    const now = Date.now()

    if (now < anilistCooldownUntil) {
      await new Promise((resolve) => setTimeout(resolve, anilistCooldownUntil - now))
      continue
    }

    refillTokens()

    if (tokens >= 1) {
      tokens -= 1
      return
    }

    await new Promise((resolve) => setTimeout(resolve, refillIntervalMs))
  }
}

async function performAnilistRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
  retryCount = 0
): Promise<AnilistResponse<T>> {
  await waitForAnilistSlot()

  try {
    const response = await fetchWithRetry(
      ANILIST_API,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
      },
      { timeoutMs: 20000 }
    )

    applyRateLimitHeaders(response.headers)

    if (response.status === 429) {
      anilistRateLimited = true
      if (retryCount >= 5) {
        return { data: null, errors: [{ message: 'AniList rate limited' }] }
      }
      const retryAfterHeader = Number.parseInt(response.headers.get('Retry-After') || '', 10)
      const retryAfter =
        Number.isFinite(retryAfterHeader) && retryAfterHeader >= 0 ? retryAfterHeader : 5
      const delay = Math.min(retryAfter * 1000, 60000)
      anilistCooldownUntil = Math.max(anilistCooldownUntil, Date.now() + delay)
      refillIntervalMs = Math.min(60000, Math.max(refillIntervalMs, 1500) * 1.15)
      logger.warn({ retryAfter, retryCount }, 'AniList rate limited, retrying')
      return performAnilistRequest(query, variables, retryCount + 1)
    }

    if (response.status === 403 || response.status >= 500) {
      anilistDownUntil = Date.now() + DOWN_COOLDOWN_MS
      anilistRateLimited = false
    } else if (response.status >= 200 && response.status < 300) {
      anilistDownUntil = 0
      anilistRateLimited = false
    }

    const json = (await parseJsonBody(response)) as {
      data?: T | null
      errors?: { message: string }[]
    }

    if (json.errors && !json.data) {
      logger.warn({ status: response.status, errors: json.errors }, 'AniList request failed')
    }

    return { data: json.data ?? null, errors: json.errors }
  } catch (err) {
    anilistDownUntil = Math.max(anilistDownUntil, Date.now() + NETWORK_COOLDOWN_MS)
    logger.error({ err }, 'AniList request error')
    return null
  }
}

export function anilistRequest<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<AnilistResponse<T>> {
  if (anilistUnavailable()) {
    return Promise.resolve({ data: null, errors: [{ message: 'AniList unavailable' }] })
  }
  const cacheKey = getAnilistCacheKey(query, variables)
  const existing = inFlightAnilistRequests.get(cacheKey)
  if (existing) return existing as Promise<AnilistResponse<T>>

  const request = performAnilistRequest<T>(query, variables)
  inFlightAnilistRequests.set(cacheKey, request as Promise<AnilistResponse<unknown>>)
  request.then(
    () => inFlightAnilistRequests.delete(cacheKey),
    () => inFlightAnilistRequests.delete(cacheKey)
  )
  return request
}
