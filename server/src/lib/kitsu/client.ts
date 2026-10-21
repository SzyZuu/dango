import logger from '../../logger.js'
import { parseJsonBody } from '../../utils/http.utils.js'

const KITSU_BASE = 'https://kitsu.app/api/edge'
const KITSU_HEADERS = { Accept: 'application/vnd.api+json', 'User-Agent': 'dango' }
const REQUEST_TIMEOUT_MS = 15000
const MAX_RETRIES = 3

export interface KitsuEntry {
  id: string
  type: string
  attributes: Record<string, unknown>
  relationships?: Record<
    string,
    { data?: { id: string; type: string } | { id: string; type: string }[] }
  >
}

interface KitsuResponse {
  data?: KitsuEntry | KitsuEntry[]
  included?: KitsuEntry[]
  meta?: { count?: number }
  errors?: { title?: string; detail?: string }[]
}

export async function kitsuFetch(path: string): Promise<KitsuResponse | null> {
  let lastError: string | null = null
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const res = await fetch(`${KITSU_BASE}${path}`, {
          headers: KITSU_HEADERS,
          signal: controller.signal,
        })
        if (res.status === 429 || res.status >= 500) {
          lastError = `kitsu fetch failed with status ${res.status}`
          await new Promise((r) => setTimeout(r, 1000 * attempt))
          continue
        }
        if (!res.ok) {
          logger.warn({ status: res.status, path }, 'Kitsu request failed')
          return null
        }
        return parseJsonBody<KitsuResponse>(res)
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 500 * attempt))
    }
  }
  logger.warn({ lastError }, 'Kitsu request error')
  return null
}

export function asArray(data?: KitsuEntry | KitsuEntry[]): KitsuEntry[] {
  if (!data) return []
  return Array.isArray(data) ? data : [data]
}

export function includedMap(
  entry: KitsuEntry,
  included: KitsuEntry[] | undefined,
  type: string
): KitsuEntry[] {
  if (!included || !entry.relationships) return []
  const rel = entry.relationships[type]
  if (!rel?.data) return []
  const ids = new Set<string>()
  for (const item of Array.isArray(rel.data) ? rel.data : [rel.data]) {
    ids.add(item.id)
  }
  return included.filter((i) => i.type === type && ids.has(i.id))
}
