import type { TrpcContext } from './context.js'

export async function cached<T>(
  ctx: TrpcContext,
  key: string,
  ttl: number | undefined,
  produce: () => Promise<T>,
  validate?: (data: T) => boolean
): Promise<T> {
  const hit = ctx.apiCache.get<T>(key)
  if (hit) return hit
  const body = await produce()
  if (!validate || validate(body)) {
    if (ttl !== undefined) ctx.apiCache.set(key, body, ttl)
    else ctx.apiCache.set(key, body)
  }
  return body
}
