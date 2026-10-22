import crypto from 'node:crypto'
import type { DatabaseWrapper } from '../../db.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import { withTrackerLock } from './sync-lock.js'

export const MAL_KEYS = {
  clientId: 'tracker_mal_client_id',
  clientSecret: 'tracker_mal_client_secret',
  tokens: 'tracker_mal_tokens',
  user: 'tracker_mal_user',
  pending: 'tracker_mal_oauth_pending',
} as const

export interface MalTokens {
  access_token: string
  refresh_token: string
  expiresAt: number
}
export interface MalListStatus {
  status: string
  num_episodes_watched: number
  score?: number
  updated_at?: string
}
export interface MalAnime {
  id: number
  title: string
  main_picture?: { medium?: string; large?: string }
  num_episodes?: number
  my_list_status?: MalListStatus
}
export interface MalListEntry {
  node: MalAnime
  list_status: MalListStatus
}

export const MAL_TO_DANGO: Record<string, string> = {
  watching: 'Watching',
  completed: 'Completed',
  on_hold: 'On-Hold',
  dropped: 'Dropped',
  plan_to_watch: 'Planned',
}
const DANGO_TO_MAL: Record<string, string> = Object.fromEntries(
  Object.entries(MAL_TO_DANGO).map(([remote, local]) => [local, remote])
)

async function setting(db: DatabaseWrapper, key: string): Promise<string> {
  return (await SettingsRepository.getByKey(db, key))?.value || ''
}

async function credentials(db: DatabaseWrapper) {
  const clientId = (await setting(db, MAL_KEYS.clientId)) || process.env.MAL_CLIENT_ID || ''
  const clientSecret =
    (await setting(db, MAL_KEYS.clientSecret)) || process.env.MAL_CLIENT_SECRET || ''
  if (!clientId) throw new Error('Enter your MyAnimeList client ID in Trackers first.')
  return { clientId, clientSecret }
}

async function exchange(db: DatabaseWrapper, fields: Record<string, string>): Promise<MalTokens> {
  const { clientId, clientSecret } = await credentials(db)
  const body = new URLSearchParams({ ...fields, client_id: clientId })
  if (clientSecret) body.set('client_secret', clientSecret)
  const response = await fetch('https://myanimelist.net/v1/oauth2/token', {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok)
    throw new Error(
      `MyAnimeList authentication failed (${response.status}). Check your app configuration or reconnect.`
    )
  const data = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!data.access_token || !data.refresh_token || !data.expires_in)
    throw new Error('Invalid MyAnimeList token response.')
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
}

export async function beginMalLogin(db: DatabaseWrapper, redirectUri: string) {
  const redirect = new URL(redirectUri)
  if (
    !['http:', 'https:'].includes(redirect.protocol) ||
    redirect.username ||
    redirect.password ||
    redirect.pathname !== '/trackers' ||
    redirect.search ||
    redirect.hash
  ) {
    throw new Error('Use the Trackers page URL as the MyAnimeList redirect URI.')
  }
  const { clientId } = await credentials(db)
  // MAL supports PKCE's plain method. A 128-character random verifier meets RFC 7636.
  const verifier = crypto.randomBytes(64).toString('hex')
  const state = `mal:${crypto.randomBytes(32).toString('hex')}`
  await SettingsRepository.upsert(
    db,
    MAL_KEYS.pending,
    JSON.stringify({ state, verifier, redirectUri, expiresAt: Date.now() + 10 * 60 * 1000 })
  )
  const url = new URL('https://myanimelist.net/v1/oauth2/authorize')
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    state,
    redirect_uri: redirectUri,
    code_challenge: verifier,
    code_challenge_method: 'plain',
  }).toString()
  return { url: url.toString(), state }
}

export function finishMalLogin(db: DatabaseWrapper, code: string, state: string) {
  return withTrackerLock(db, 'mal', () => completeMalLogin(db, code, state))
}

async function completeMalLogin(db: DatabaseWrapper, code: string, state: string) {
  // Consume state before making network requests so a callback cannot be replayed.
  let pending:
    { state: string; verifier: string; redirectUri: string; expiresAt: number } | undefined
  await db.transact(async (tx) => {
    const raw = await setting(tx, MAL_KEYS.pending)
    if (raw) pending = JSON.parse(raw)
    if (!pending || pending.state !== state || pending.expiresAt < Date.now())
      throw new Error('MyAnimeList login expired or has invalid state. Connect again.')
    await SettingsRepository.deleteByKey(tx, MAL_KEYS.pending)
  })
  const tokens = await exchange(db, {
    grant_type: 'authorization_code',
    code,
    code_verifier: pending!.verifier,
    redirect_uri: pending!.redirectUri,
  })
  const response = await fetch('https://api.myanimelist.net/v2/users/@me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`Could not read your MyAnimeList profile (${response.status}).`)
  const viewer = (await response.json()) as { id: number; name: string; picture?: string }
  const user = { id: viewer.id, name: viewer.name, avatar: viewer.picture }
  await db.transact(async (tx) => {
    await SettingsRepository.upsert(tx, MAL_KEYS.tokens, JSON.stringify(tokens))
    await SettingsRepository.upsert(tx, MAL_KEYS.user, JSON.stringify(user))
    await SettingsRepository.deleteByKey(tx, 'tracker_mal_sync_state')
    tx.run("DELETE FROM tracker_updates WHERE provider = 'mal'")
  })
  return user
}

const refreshes = new WeakMap<DatabaseWrapper, Promise<MalTokens>>()

export class MalTracker {
  private db: DatabaseWrapper

  constructor(db: DatabaseWrapper) {
    this.db = db
  }

  private async tokens(force = false): Promise<MalTokens> {
    const raw = await setting(this.db, MAL_KEYS.tokens)
    if (!raw) throw new Error('MyAnimeList is not connected. Connect your account in Trackers.')
    const tokens = JSON.parse(raw) as MalTokens
    if (!force && tokens.expiresAt > Date.now() + 60000) return tokens
    const existing = refreshes.get(this.db)
    if (existing) return existing
    const refresh = (async () => {
      const updated = await exchange(this.db, {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
      })
      // A disconnected account must not be silently reconnected by an in-flight refresh.
      if ((await setting(this.db, MAL_KEYS.tokens)) !== raw)
        throw new Error('MyAnimeList connection changed. Retry sync.')
      await SettingsRepository.upsert(this.db, MAL_KEYS.tokens, JSON.stringify(updated))
      return updated
    })()
    refreshes.set(this.db, refresh)
    try {
      return await refresh
    } finally {
      refreshes.delete(this.db)
    }
  }

  async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const tokens = await this.tokens()
    const response = await fetch(`https://api.myanimelist.net/v2/${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(20000),
    })
    if (response.status === 401 && retry) {
      await this.tokens(true)
      return this.request(path, init, false)
    }
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? 'MyAnimeList rate limit reached. Pending episode updates will retry automatically.'
          : `MyAnimeList request failed (${response.status}). Reconnect if access has expired.`
      )
    return (await response.json()) as T
  }

  getAnime(id: number) {
    return this.request<MalAnime>(`anime/${id}?fields=my_list_status,num_episodes`)
  }

  async fetchList(): Promise<MalListEntry[]> {
    const entries: MalListEntry[] = []
    let offset = 0
    while (true) {
      const page = await this.request<{ data: MalListEntry[]; paging?: { next?: string } }>(
        `users/@me/animelist?fields=list_status,num_episodes&limit=1000&offset=${offset}&nsfw=true`
      )
      entries.push(...page.data)
      if (!page.paging?.next || !page.data.length) break
      // Construct the next URL ourselves; never send bearer tokens to a supplied URL.
      offset += page.data.length
    }
    return entries
  }

  update(id: number, progress: number, status: string) {
    const remoteStatus = DANGO_TO_MAL[status]
    if (!remoteStatus) throw new Error(`Unsupported tracker status: ${status}`)
    return this.request<MalListStatus>(`anime/${id}/my_list_status`, {
      method: 'PUT',
      body: new URLSearchParams({ status: remoteStatus, num_watched_episodes: String(progress) }),
    })
  }
}
