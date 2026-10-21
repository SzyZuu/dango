import type { Context } from 'hono'
import { gotScraping } from 'got-scraping'
import { buildCfClearanceCookie } from '../../utils/cookie.utils.js'
import { isSafeExternalUrl } from '../../utils/security.utils.js'
import { linkAbort } from '../../utils/http.utils.js'
import type { RemoteProxyRule } from '../../providers/remote-types.js'
import { matchProxyRule, PROXY_UA, resolveOrigin } from './rules.js'
import path from 'path'
import fs from 'fs'
import { CONFIG } from '../../config.js'

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

export function placeholderSvg(): Response | null {
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

export async function proxyEmbed(c: Context, getProxyRules: () => RemoteProxyRule[]) {
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
}
