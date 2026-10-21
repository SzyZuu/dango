import type { Hono } from 'hono'
import { gotScraping } from 'got-scraping'
import path from 'path'
import { AppCache } from '../utils/cache.utils.js'
import { CONFIG } from '../config.js'
import fs from 'fs'
import logger from '../logger.js'
import { buildCfClearanceCookie, sanitizeCfClearance } from '../utils/cookie.utils.js'
import { isSafeExternalUrl } from '../utils/security.utils.js'
import { fetchWithRetry, linkAbort, setProxyHeaders } from '../utils/http.utils.js'
import { pinVariant } from './playlist.js'
import type { RemoteProxyRule } from '../providers/remote-types.js'

const proxyCache = new AppCache({ ttlSeconds: 30, maxKeys: 500 })
const imageCache = new AppCache({ ttlSeconds: 86400, maxKeys: 3000 })

function assTimeToVtt(value: string): string | null {
  const m = value.trim().match(/^(-?\d+):(\d{2}):(\d{2})[.:](\d{2,3})$/)
  if (!m) return null
  const h = String(Math.max(0, parseInt(m[1], 10))).padStart(2, '0')
  const ms = m[4].length === 2 ? `${m[4]}0` : m[4]
  return `${h}:${m[2]}:${m[3]}.${ms}`
}

function assToVtt(body: string): string | null {
  if (!/^\s*\[Script Info\]/im.test(body)) return null
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  let inEvents = false
  let format: string[] | null = null
  const cues: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (/^\[Events\]/i.test(line)) {
      inEvents = true
      continue
    }
    if (/^\[/.test(line)) {
      inEvents = false
      continue
    }
    if (!inEvents) continue
    if (/^Format\s*:/i.test(line)) {
      format = line
        .replace(/^Format\s*:/i, '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
      continue
    }
    if (!/^Dialogue\s*:/i.test(line) || !format) continue
    const payload = line.replace(/^Dialogue\s*:/i, '')
    const parts: string[] = []
    let rest = payload
    for (let i = 0; i < format.length - 1; i++) {
      const idx = rest.indexOf(',')
      if (idx < 0) break
      parts.push(rest.slice(0, idx))
      rest = rest.slice(idx + 1)
    }
    parts.push(rest)
    const start = assTimeToVtt(parts[format.indexOf('start')] ?? '')
    const end = assTimeToVtt(parts[format.indexOf('end')] ?? '')
    if (!start || !end || format.indexOf('text') < 0) continue
    const text = (parts[format.indexOf('text')] ?? '')
      .replace(/\\\\/g, '\\u0000')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/gi, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\h/gi, ' ')
      .replace(/\\[a-zA-Z]+\d*/g, '')
      .replace(/\\u0000/g, '\\')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n')
    if (!text) continue
    cues.push(`${start} --> ${end}\n${text}`)
    if (cues.length > 5000) break
  }
  if (cues.length === 0) return null
  return `WEBVTT\n\n${cues.join('\n\n')}\n`
}

const SUB_WRAP_AT = 50

function splitBalancedCueLine(line: string): string[] {
  const words = line.split(/\s+/).filter((w) => w.length > 0)
  if (words.length < 2) return [line]
  const total = words.join(' ').length
  if (total <= SUB_WRAP_AT) return [line]
  const target = total / 2
  let acc = words[0]?.length ?? 0
  let best = 1
  let bestDiff = Math.abs(acc - target)
  for (let i = 1; i < words.length; i++) {
    acc += 1 + (words[i]?.length ?? 0)
    const diff = Math.abs(acc - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = i + 1
    }
  }
  if (best <= 0 || best >= words.length) return [line]
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')]
}

function rewrapVttCues(vtt: string): string {
  const blocks = vtt.replace(/\r\n/g, '\n').split(/\n\n+/)
  return blocks
    .map((block, idx) => {
      if (idx === 0 && /^\s*WEBVTT/i.test(block)) return block
      const lines = block.split('\n')
      const tIdx = lines.findIndex((l) => l.includes('-->'))
      if (tIdx < 0) return block
      const payload = lines.slice(tIdx + 1).filter((l) => l.trim() !== '')
      if (payload.length !== 1) return block
      const split = splitBalancedCueLine((payload[0] ?? '').trim())
      if (split.length < 2) return block
      return [...lines.slice(0, tIdx + 1), ...split].join('\n')
    })
    .join('\n\n')
}

function matchProxyRule(urlStr: string, rules: RemoteProxyRule[]): RemoteProxyRule | undefined {
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

function resolveOrigin(
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

async function fetchWithMirrors<T>(
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

export function applyEmbedPatches(
  html: string,
  embedUrl: URL,
  cookieStr: string = ''
): string | null {
  const safeReferer = JSON.stringify(embedUrl.href).replace(/</g, '\\u003c')
  const safeCookie = JSON.stringify(cookieStr).replace(/</g, '\\u003c')

  const patched = html.replace(
    /\b(src|href|url)\s*[=:]\s*(["']?)(\/\/[^"'>)]+|\/(?!\/)[^"'>)]*)\2/gi,
    (match, attr, quote, path) => {
      const full = path.startsWith('//') ? `https:${path}` : `${embedUrl.origin}${path}`
      const prefix = match.startsWith('url') ? `url(` : `${attr}=`
      const suffix = match.startsWith('url') ? `)` : ''
      return `${prefix}${quote}${full}${quote}${suffix}`
    }
  )

  const iconProxy = `/api/proxy?url=${encodeURIComponent(`${embedUrl.origin}/app/js/vendor/plyr.svg`)}&referer=${encodeURIComponent(embedUrl.href)}`
  const plyrPatch = `<script>if(window.Plyr) Plyr.defaults.iconUrl=${JSON.stringify(iconProxy).replace(/</g, '\\u003c')};</script>`

  const hlsPatch = `<script>
      (function() {
        var hook = function() {
          if (!window.Hls) return;
          var original = Hls.prototype.loadSource;
          Hls.prototype.loadSource = function(src) {
            if (typeof src === 'string' && src.includes('.m3u8')) {
              src = window.location.origin + '/api/proxy?url=' + encodeURIComponent(src) + '&referer=' + encodeURIComponent(${safeReferer}) + (${safeCookie} ? '&cookie=' + encodeURIComponent(${safeCookie}) : '');
            }
            return original.call(this, src);
          };
        };
        if (window.Hls) hook();
        else {
          var observer = new MutationObserver(function() {
            if (window.Hls) { hook(); observer.disconnect(); }
          });
          observer.observe(document.documentElement, { childList: true, subtree: true });
        }
      })();
    </script>`

  const endBridgePatch = `<script>
      (function() {
        var notified = false;
        var notifyEnded = function() {
          if (notified) return;
          notified = true;
          window.parent.postMessage({ type: 'ANI_WEB_MEDIA_ENDED' }, window.location.origin);
        };

        var attachToVideos = function(root) {
          var scope = root || document;
          var videos = scope.querySelectorAll ? scope.querySelectorAll('video') : [];
          Array.prototype.forEach.call(videos, function(video) {
            if (video.dataset && video.dataset.aniWebEndedBridge === 'true') return;
            if (video.dataset) video.dataset.aniWebEndedBridge = 'true';
            video.addEventListener('ended', notifyEnded, { once: true });
          });
        };

        attachToVideos(document);

        var observer = new MutationObserver(function() {
          attachToVideos(document);
        });

        observer.observe(document.documentElement, { childList: true, subtree: true });
      })();
    </script>`

  const beforePlyr = patched.replace(
    /(<script[^>]+\/plyr\.min\.js[^>]*><\/script>)/i,
    `$1${plyrPatch}`
  )
  const final = beforePlyr
    .replace(/(<script[^>]+hls(?:\.min)?\.js[^>]*><\/script>)/i, `$1${hlsPatch}`)
    .replace(/<\/body>/i, `${endBridgePatch}</body>`)

  if (final === html) {
    // nothing to patch: still a page (a gateway without a </body>), so serve it
    // as-is. a non-html body is not a gateway at all and stays null -> 502.
    return /<\s*(html|body)\b/i.test(html) ? html : null
  }
  return final
}

function placeholderSvg(): Response | null {
  const possiblePaths = [
    path.join(CONFIG.PACKAGE_ROOT, 'client/public/placeholder.svg'),
    path.join(CONFIG.PACKAGE_ROOT, 'client/dist/placeholder.svg'),
    path.join(CONFIG.SERVER_ROOT, '..', 'client/public/placeholder.svg'),
  ]

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        const headers = new Headers()
        headers.set('Cache-Control', 'no-store')
        headers.set('Content-Type', 'image/svg+xml')
        return new Response(fs.readFileSync(p), { headers })
      }
    } catch {
      // ignore
    }
  }

  return null
}

const PROXY_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0'

export function registerProxy(app: Hono, getProxyRules: () => RemoteProxyRule[]) {
  app.get('/api/proxy', async (c) => {
    const url = c.req.query('url')
    if (!url) return c.text('URL required', 400)

    const safeCheck = isSafeExternalUrl(url)
    if (!safeCheck.safe) {
      return c.text(safeCheck.error || 'Invalid URL', 400)
    }

    const urlStr = url as string
    const rule = matchProxyRule(urlStr, getProxyRules())
    const refererStr = c.req.query('referer') || rule?.referer || ''
    const originStr = resolveOrigin(rule, refererStr, c.req.query('origin'))
    const uaStr = c.req.query('ua') || ''
    const cookieStr = c.req.query('cookie') || ''
    const useScrape = c.req.query('scrape') === '1' || rule?.scrape === true
    const useCf = c.req.query('cf') === '1' || rule?.cfCookie === true
    const variantRaw = c.req.query('variant')
    const variantIdx = variantRaw !== undefined ? parseInt(variantRaw, 10) : NaN
    const pinVar = Number.isInteger(variantIdx) && (variantIdx as number) >= 0
    const cacheKey = `m3u8-${urlStr}-${refererStr}-${originStr}-${uaStr}-${sanitizeCfClearance(cookieStr)}-${useScrape ? 'scrape' : 'raw'}-${useCf ? 'cf' : 'nocf'}${pinVar ? `-v${variantIdx}` : ''}`

    const abort = new AbortController()
    linkAbort(c.req.raw.signal, abort)

    try {
      const headers: Record<string, string> = {
        'User-Agent': uaStr || PROXY_UA,
      }
      if (refererStr) headers['Referer'] = refererStr
      if (originStr) headers['Origin'] = originStr
      if (cookieStr) {
        const cookieHeader = useCf ? buildCfClearanceCookie(cookieStr) : cookieStr
        if (cookieHeader) headers['Cookie'] = cookieHeader
      }
      const range = c.req.header('range')
      if (range) headers['Range'] = range

      const playlistResponse = (body: string) => {
        const outHeaders = new Headers()
        outHeaders.set('Content-Type', 'application/vnd.apple.mpegurl')
        outHeaders.set('Access-Control-Allow-Origin', '*')
        return new Response(body, { headers: outHeaders })
      }
      const rewritePlaylist = (playlistBody: string, finalUrl: string) => {
        const baseUrl = new URL(finalUrl)
        const proxiedMediaUrl = (targetUrl: string) => {
          const params = new URLSearchParams({ url: targetUrl })
          if (refererStr) params.set('referer', refererStr)
          if (originStr) params.set('origin', originStr)
          if (uaStr) params.set('ua', uaStr)
          if (cookieStr) params.set('cookie', sanitizeCfClearance(cookieStr))
          if (useScrape) params.set('scrape', '1')
          if (useCf) params.set('cf', '1')
          return `/api/proxy?${params}`
        }
        const needsProxy = Boolean(refererStr || originStr || uaStr || useScrape)
        const isProxied = (value: string) => value.includes('/api/proxy')
        const pinned = pinVar ? pinVariant(playlistBody, variantIdx as number) : null
        return (pinned || playlistBody)
          .split('\n')
          .map((line: string) => {
            const trimmed = line.trim()
            if (!trimmed) return line

            if (trimmed.startsWith('#')) {
              return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
                if (isProxied(uri)) return `URI="${uri}"`
                const absolute = new URL(uri, baseUrl).href
                return `URI="${needsProxy || absolute.includes('.m3u8') ? proxiedMediaUrl(absolute) : absolute}"`
              })
            }

            if (isProxied(trimmed)) return line

            const absolute = new URL(trimmed, baseUrl).href
            return proxiedMediaUrl(absolute)
          })
          .join('\n')
      }

      if (urlStr.includes('.m3u8')) {
        const cached = proxyCache.get<string>(cacheKey)
        if (cached) {
          const headers = new Headers()
          headers.set('Content-Type', 'application/vnd.apple.mpegurl')
          headers.set('Access-Control-Allow-Origin', '*')
          return new Response(cached, { headers })
        }

        const resp = await fetchWithMirrors(
          urlStr,
          rule?.mirrors,
          abort.signal,
          (candidate) =>
            gotScraping({
              url: candidate,
              method: 'GET',
              headers,
              responseType: 'text',
              timeout: { request: 30000 },
              followRedirect: true,
              throwHttpErrors: false,
            }),
          (attempt) => attempt.statusCode === 200 || attempt.statusCode === 206
        )

        if (!resp || (resp.statusCode !== 200 && resp.statusCode !== 206)) {
          return c.text('Upstream error', (resp?.statusCode || 502) as 502)
        }

        const rewritten = rewritePlaylist(resp.body as string, resp.url || urlStr)
        proxyCache.set(cacheKey, rewritten)
        return playlistResponse(rewritten)
      } else {
        if (useScrape) {
          const resp = await fetchWithMirrors(
            urlStr,
            rule?.mirrors,
            abort.signal,
            (candidate) =>
              gotScraping({
                url: candidate,
                method: 'GET',
                headers,
                responseType: 'buffer',
                timeout: { request: 30000 },
                followRedirect: true,
                throwHttpErrors: false,
              }),
            (attempt) => attempt.statusCode === 200 || attempt.statusCode === 206
          )

          if (!resp || (resp.statusCode !== 200 && resp.statusCode !== 206)) {
            return c.text('Upstream error', (resp?.statusCode || 502) as 502)
          }

          const ct = resp.headers['content-type']
          const isVtt = urlStr.endsWith('.vtt') || urlStr.includes('.vtt?')
          const bodyText = String(resp.body ?? '')
          if (
            !isVtt &&
            ((typeof ct === 'string' && ct.includes('mpegurl')) || bodyText.startsWith('#EXTM3U'))
          ) {
            const cached = proxyCache.get<string>(cacheKey)
            const rewritten = cached ?? rewritePlaylist(bodyText, resp.url || urlStr)
            if (!cached) proxyCache.set(cacheKey, rewritten)
            return playlistResponse(rewritten)
          }
          const outHeaders = new Headers()
          outHeaders.set(
            'Content-Type',
            isVtt ? 'text/vtt; charset=utf-8' : ct || 'application/octet-stream'
          )
          setProxyHeaders(outHeaders, (name) => resp.headers[name])
          return new Response(resp.body as BodyInit, {
            status: resp.statusCode as 200,
            headers: outHeaders,
          })
        } else {
          const upstream = await fetchWithMirrors(
            urlStr,
            rule?.mirrors,
            abort.signal,
            async (candidate) => {
              const attempt = await fetchWithRetry(
                candidate,
                { method: 'GET', headers },
                { retries: 3, timeoutMs: 30000, signal: abort.signal }
              )
              if (attempt.status !== 200 && attempt.status !== 206) {
                try {
                  await attempt.body?.cancel()
                } catch {
                  // ignore
                }
              }
              return attempt
            },
            (attempt) => attempt.status === 200 || attempt.status === 206
          )
          if (!upstream) {
            return c.text('Upstream error', 502)
          }
          const status = upstream.status
          if (status !== 200 && status !== 206) {
            try {
              await upstream.body?.cancel()
            } catch {
              // ignore
            }
            return c.text('Upstream error', status as 200)
          }
          const isVtt = urlStr.endsWith('.vtt') || urlStr.includes('.vtt?')
          const ct = upstream.headers.get('content-type')
          const outHeaders = new Headers()
          outHeaders.set(
            'Content-Type',
            isVtt ? 'text/vtt; charset=utf-8' : ct || 'application/octet-stream'
          )
          setProxyHeaders(outHeaders, (name) => upstream.headers.get(name))
          if (!upstream.body) {
            return c.text('Upstream error', 502)
          }
          return new Response(upstream.body, { status: status as 200, headers: outHeaders })
        }
      }
    } catch (e) {
      if (abort.signal.aborted) return new Response(null, { status: 499 })
      logger.error({ url: urlStr, error: (e as Error)?.message }, '[proxy] upstream request failed')
      return c.text('Proxy error', 500)
    }
  })

  app.get('/api/embed-proxy', async (c) => {
    const rawUrl = c.req.query('url')
    if (!rawUrl) return c.text('URL required', 400)
    const safeCheck = isSafeExternalUrl(rawUrl)
    if (!safeCheck.safe) return c.text(safeCheck.error || 'Invalid URL', 400)

    const rule = matchProxyRule(rawUrl, getProxyRules())
    if (!rule?.embedPatch) return c.text('Invalid or unsupported gateway URL', 400)

    const embedUrl = new URL(rawUrl)
    const cookieStr = c.req.query('cookie') || ''
    const refererStr = c.req.query('referer') || rule.referer || ''
    const originStr = resolveOrigin(rule, refererStr, c.req.query('origin'))
    const abort = new AbortController()
    linkAbort(c.req.raw.signal, abort)

    try {
      const headers: Record<string, string> = {
        'User-Agent': c.req.query('ua') || PROXY_UA,
      }
      if (refererStr) headers['Referer'] = refererStr
      if (originStr) headers['Origin'] = originStr
      if (cookieStr) {
        const cookieHeader =
          c.req.query('cf') === '1' || rule.cfCookie ? buildCfClearanceCookie(cookieStr) : cookieStr
        if (cookieHeader) headers['Cookie'] = cookieHeader
      }

      const response = await gotScraping({
        url: embedUrl.href,
        method: 'GET',
        headers,
        responseType: 'text',
        timeout: { request: 30000 },
        followRedirect: true,
        throwHttpErrors: false,
      })

      const originalHtml = response.body as string
      const patched = applyEmbedPatches(originalHtml, embedUrl, cookieStr)
      if (!patched) return c.text('Failed to patch video gateway', 502)

      const outHeaders = new Headers()
      outHeaders.set('Content-Type', 'text/html; charset=utf-8')
      outHeaders.set('Cache-Control', 'private, max-age=120')
      return new Response(patched, { status: 200, headers: outHeaders })
    } catch {
      if (abort.signal.aborted) return new Response(null, { status: 499 })
      return c.text('Gateway proxy error', 502)
    }
  })

  app.get('/api/subtitle-proxy', async (c) => {
    const url = c.req.query('url')
    if (!url) return c.text('URL required', 400)

    const safeCheck = isSafeExternalUrl(url)
    if (!safeCheck.safe) {
      return c.text(safeCheck.error || 'Invalid URL', 400)
    }

    const abort = new AbortController()
    linkAbort(c.req.raw.signal, abort)

    const subUrl = url as string
    const rule = matchProxyRule(subUrl, getProxyRules())
    const refererStr = c.req.query('referer') || rule?.referer || ''
    const originStr = resolveOrigin(rule, refererStr, c.req.query('origin'))
    const useScrape = c.req.query('scrape') === '1' || rule?.scrape === true
    const cookieStr = c.req.query('cookie') || ''

    const buildHeaders = (): Record<string, string> => {
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/vtt,text/plain,*/*;q=0.8',
      }
      if (refererStr) headers['Referer'] = refererStr
      if (originStr) headers['Origin'] = originStr
      if (cookieStr) {
        const cookieHeader =
          c.req.query('cf') === '1' || rule?.cfCookie
            ? buildCfClearanceCookie(cookieStr)
            : cookieStr
        if (cookieHeader) headers['Cookie'] = cookieHeader
      }
      return headers
    }

    const fetchText = async (
      target: string,
      retries = 1
    ): Promise<{ status: number; body: string } | null> => {
      const headers = buildHeaders()
      if (useScrape) {
        try {
          const upstream = await gotScraping({
            url: target,
            method: 'GET',
            headers,
            responseType: 'text',
            timeout: { request: 15000 },
            followRedirect: true,
            throwHttpErrors: false,
          })
          if (upstream.statusCode !== 200) {
            logger.warn(
              { target, status: upstream.statusCode },
              '[subtitle-proxy] upstream returned error status'
            )
            return { status: upstream.statusCode, body: '' }
          }
          const body = String(upstream.body ?? '').replace(/^\uFEFF/, '')
          if (/^\s*\{[\s\S]*"error"[\s\S]*\}\s*$/.test(body.slice(0, 500))) {
            logger.warn(
              { target, body: body.slice(0, 200) },
              '[subtitle-proxy] upstream JSON error'
            )
            return { status: 502, body: '' }
          }
          return { status: 200, body }
        } catch (e) {
          if (abort.signal.aborted) return null
          logger.warn(
            { target, error: (e as Error)?.message },
            '[subtitle-proxy] upstream fetch failed'
          )
          return { status: 502, body: '' }
        }
      }
      try {
        const upstream = await fetchWithRetry(
          target,
          { method: 'GET', headers },
          { retries, timeoutMs: 15000, signal: abort.signal }
        )
        if (!upstream.ok) {
          logger.warn(
            { target, status: upstream.status },
            '[subtitle-proxy] upstream returned error status'
          )
          try {
            await upstream.body?.cancel()
          } catch {
            // ignore
          }
          return { status: upstream.status, body: '' }
        }
        const body = (await upstream.text()).replace(/^\uFEFF/, '')
        if (/^\s*\{[\s\S]*"error"[\s\S]*\}\s*$/.test(body.slice(0, 500))) {
          logger.warn({ target, body: body.slice(0, 200) }, '[subtitle-proxy] upstream JSON error')
          return { status: 502, body: '' }
        }
        return { status: upstream.status, body }
      } catch (e) {
        if (abort.signal.aborted) return null
        logger.warn(
          { target, error: (e as Error)?.message },
          '[subtitle-proxy] upstream fetch failed'
        )
        return { status: 502, body: '' }
      }
    }

    const vttHeaders = (cacheControl: string) => {
      const headers = new Headers()
      headers.set('Content-Type', 'text/vtt; charset=utf-8')
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('Cache-Control', cacheControl)
      return headers
    }

    const subtitleError = (text: string) => {
      const headers = new Headers()
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('Cache-Control', 'no-store')
      return new Response(text, { status: 502, headers })
    }

    try {
      const headers = buildHeaders()

      const result = await fetchText(subUrl, 1)
      if (abort.signal.aborted) return new Response(null, { status: 499 })
      if (!result || !result.body) {
        return subtitleError('Subtitle upstream error')
      }
      const body = result.body
      const baseForSegments = subUrl
      if (/#EXTM3U/i.test(body.slice(0, 1000))) {
        const segUrls = body
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'))
          .slice(0, 200)
          .map((u) => {
            try {
              return new URL(u, baseForSegments).href
            } catch {
              return null
            }
          })
          .filter((u): u is string => Boolean(u))
        const parts: string[] = []
        for (const seg of segUrls) {
          try {
            const segRes = await fetchWithRetry(
              seg,
              { method: 'GET', headers },
              { retries: 1, timeoutMs: 15000, signal: abort.signal }
            )
            if (!segRes.ok) continue
            let segBody = (await segRes.text()).replace(/^\uFEFF/, '')
            if (/#EXTM3U/i.test(segBody.slice(0, 200))) continue
            segBody = segBody
              .replace(/\r\n/g, '\n')
              .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
            if (/^\s*WEBVTT/i.test(segBody)) {
              segBody = segBody.replace(/^\s*WEBVTT[^\n]*\n(\n|.*\n)?/, '')
            }
            segBody = segBody.trim()
            if (segBody) parts.push(segBody)
            if (parts.join('\n').length > 2_000_000) break
          } catch {
            if (abort.signal.aborted) return new Response(null, { status: 499 })
          }
        }
        if (parts.length === 0) {
          return subtitleError('Subtitle playlist empty')
        }
        return new Response(rewrapVttCues(`WEBVTT\n\n${parts.join('\n\n')}\n`), {
          headers: vttHeaders('public, max-age=86400'),
        })
      }
      if (/^\s*WEBVTT/i.test(body)) {
        return new Response(rewrapVttCues(body), {
          headers: vttHeaders('public, max-age=86400'),
        })
      }
      const vttFromAss = assToVtt(body)
      if (vttFromAss) {
        return new Response(rewrapVttCues(vttFromAss), {
          headers: vttHeaders('public, max-age=86400'),
        })
      }
      return new Response(
        rewrapVttCues(
          `WEBVTT\n\n${body.replace(/\r\n/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`
        ),
        { headers: vttHeaders('public, max-age=86400') }
      )
    } catch {
      if (abort.signal.aborted) return new Response(null, { status: 499 })
      logger.warn({ url: subUrl }, '[subtitle-proxy] failed')
      return subtitleError('Subtitle upstream error')
    }
  })

  app.get('/api/image-proxy', async (c) => {
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
  })

  app.get('/api/resolve', async (c) => {
    const targetUrl = c.req.query('url')
    if (!targetUrl || typeof targetUrl !== 'string') {
      return c.json({ error: 'URL required' }, 400)
    }

    const safeCheck = isSafeExternalUrl(targetUrl)
    if (!safeCheck.safe) {
      return c.json({ error: safeCheck.error || 'Invalid URL' }, 400)
    }

    try {
      const response = await fetchWithRetry(
        targetUrl,
        {
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          redirect: 'follow',
        },
        { retries: 2, timeoutMs: 15000 }
      )
      void response.body?.cancel().catch(() => {})

      return c.json({
        finalUrl: response.url,
        status: response.status,
      })
    } catch (e) {
      const err = e as { message?: string }
      return c.json({ error: err.message || 'Resolve failed' }, 500)
    }
  })
}
