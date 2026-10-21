import type { RemoteProxyRule } from '../../providers/remote-types.js'

export function matchProxyRule(
  urlStr: string,
  rules: RemoteProxyRule[]
): RemoteProxyRule | undefined {
  let host: string
  try {
    host = new URL(urlStr).hostname.toLowerCase()
  } catch {
    return undefined
  }
  return rules.find(
    (r) => r.hosts?.some((h) => h === host) || r.suffixes?.some((s) => host.endsWith(s))
  )
}

export function resolveOrigin(
  rule: RemoteProxyRule | undefined,
  referer: string,
  queryOrigin?: string
): string {
  return queryOrigin || (rule?.originFromReferer ? referer : '') || rule?.origin || ''
}

export function mirrorUrls(urlStr: string, mirrors: string[] | undefined): string[] {
  if (!mirrors?.length) return [urlStr]
  let current: URL
  try {
    current = new URL(urlStr)
  } catch {
    return [urlStr]
  }
  const seen = new Set([current.hostname.toLowerCase()])
  const urls = [urlStr]
  for (const mirror of mirrors) {
    const host = mirror.toLowerCase()
    if (seen.has(host)) continue
    seen.add(host)
    const candidate = new URL(current.href)
    candidate.hostname = host
    urls.push(candidate.href)
  }
  return urls
}

export async function fetchWithMirrors<T>(
  urlStr: string,
  mirrors: string[] | undefined,
  signal: AbortSignal,
  attempt: (candidate: string) => Promise<T | null>,
  isOk: (r: T) => boolean
): Promise<T | null> {
  let last: T | null = null
  for (const candidate of mirrorUrls(urlStr, mirrors)) {
    if (signal.aborted) break
    const r = await attempt(candidate).catch(() => null)
    if (!r) continue
    if (isOk(r)) return r
    last = r
  }
  return last
}

export const PROXY_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0'
