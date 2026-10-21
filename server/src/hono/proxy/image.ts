import type { Context } from 'hono'
import { gotScraping } from 'got-scraping'
import { buildCfClearanceCookie } from '../../utils/cookie.utils.js'
import { isSafeExternalUrl } from '../../utils/security.utils.js'
import { linkAbort } from '../../utils/http.utils.js'
import type { RemoteProxyRule } from '../../providers/remote-types.js'
import logger from '../../logger.js'
import { fetchWithMirrors, matchProxyRule, resolveOrigin } from './rules.js'
import { imageCache } from './cache.js'
import { placeholderSvg } from './embed.js'

export async function proxyImage(c: Context, getProxyRules: () => RemoteProxyRule[]) {
  const url = c.req.query('url')
  if (!url) return c.text('URL required', 400)

  const safeCheck = isSafeExternalUrl(url)
  if (!safeCheck.safe) {
    return c.text(safeCheck.error || 'Invalid URL', 400)
  }

  const targetUrl = url as string
  const cookie = c.req.query('cookie') || ''
  const ua = c.req.query('ua') || ''
  const strict = c.req.query('strict') === '1'
  const rule = matchProxyRule(targetUrl, getProxyRules())
  const refererValue = c.req.query('referer') || rule?.referer || ''
  const originValue = resolveOrigin(rule, refererValue, c.req.query('origin'))
  const abort = new AbortController()
  linkAbort(c.req.raw.signal, abort)

  const headers: Record<string, string> = {
    'User-Agent':
      ua ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  }

  const cacheKey = `${targetUrl}|${cookie}|${ua}|${refererValue}|${originValue}`
  const cached = imageCache.get<{ body: Buffer; contentType: string }>(cacheKey)
  if (cached) {
    const hit = new Headers()
    hit.set('Cache-Control', 'public, max-age=604800, immutable')
    hit.set('Content-Type', cached.contentType)
    hit.set('Access-Control-Allow-Origin', '*')
    hit.set('X-Dango-Cache', 'hit')
    return new Response(cached.body as BodyInit, { headers: hit })
  }

  try {
    if (refererValue) headers['Referer'] = refererValue
    if (originValue) headers['Origin'] = originValue
    if (c.req.query('cf') === '1' || rule?.cfCookie) {
      const cookieHeader = buildCfClearanceCookie(cookie)
      if (cookieHeader) headers['Cookie'] = cookieHeader
    }

    let body: Buffer | null = null
    let contentType = 'image/webp'
    for (let attempt = 0; attempt < 3 && !body; attempt++) {
      const resp = await fetchWithMirrors(
        targetUrl,
        rule?.mirrors,
        abort.signal,
        async (candidate) =>
          gotScraping({
            url: candidate,
            method: 'GET',
            headers,
            responseType: 'buffer',
            followRedirect: true,
            throwHttpErrors: false,
            timeout: { request: 30000 },
          }),
        (r) => r.statusCode === 200 && !!r.rawBody?.length
      )
      if (resp && resp.statusCode === 200 && resp.rawBody?.length) {
        body = Buffer.from(resp.rawBody)
        contentType = String(resp.headers['content-type'] || 'image/webp')
      } else {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
      }
    }

    if (body) {
      imageCache.set(cacheKey, { body, contentType })
      const outHeaders = new Headers()
      outHeaders.set('Cache-Control', 'public, max-age=604800, immutable')
      outHeaders.set('Content-Type', contentType)
      outHeaders.set('Access-Control-Allow-Origin', '*')
      return new Response(body as BodyInit, { headers: outHeaders })
    }
    // strict=1 callers retry another candidate instead of settling for the
    // placeholder, which would otherwise read as a successful load.
    if (strict) return c.text('Not Found', 404)
    const placeholder = placeholderSvg()
    if (placeholder) return placeholder
    return c.text('Not Found', 404)
  } catch {
    if (abort.signal.aborted) return new Response(null, { status: 499 })
    if (strict) return c.text('Not Found', 502)
    const placeholder = placeholderSvg()
    if (placeholder) return placeholder
    return c.text('Not Found', 404)
  }
}
