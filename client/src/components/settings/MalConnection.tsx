import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { trpcClient } from '../../lib/trpc'
import { Button } from '../common/Button'
import { MAL_OAUTH_STATE_KEY } from '../../hooks/useMalAuthCallback'
import styles from '../../pages/Trackers.module.css'

export default function MalConnection({ connecting }: { connecting: boolean }) {
  const queryClient = useQueryClient()
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [error, setError] = useState('')
  const [summary, setSummary] = useState('')
  const initialized = useRef(false)
  const { data: config } = useQuery({
    queryKey: ['malClientConfig'],
    queryFn: () => trpcClient.tracker.malConfig.query(),
  })
  const { data: status } = useQuery({
    queryKey: ['trackerStatus'],
    queryFn: () => trpcClient.tracker.status.query(),
    refetchInterval: 15000,
  })
  useEffect(() => {
    if (config && !initialized.current) {
      setClientId(config.clientId)
      initialized.current = true
    }
  }, [config])

  const connect = useMutation({
    mutationFn: async () => {
      setError('')
      await trpcClient.tracker.malSaveConfig.mutate({
        clientId,
        clientSecret: clientSecret || undefined,
      })
      setClientSecret('')
      const result = await trpcClient.tracker.malLogin.mutate({
        redirectUri: `${window.location.origin}/trackers`,
      })
      sessionStorage.setItem(MAL_OAUTH_STATE_KEY, result.state)
      window.location.assign(result.url)
    },
    onError: (err: Error) => setError(err.message),
  })
  const disconnect = useMutation({
    mutationFn: () => trpcClient.tracker.malDisconnect.mutate(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trackerStatus'] })
      setSummary('')
      setError('')
      toast.success('Disconnected from MyAnimeList')
    },
    onError: (err: Error) => setError(err.message),
  })
  const sync = useMutation({
    mutationFn: () => trpcClient.tracker.sync.mutate({ provider: 'mal' }),
    onSuccess: (data) => {
      const s = data.summary
      setSummary(
        `Sync complete: ${s.pushed} sent, ${s.pulled} imported, ${s.merged} merged, ${s.unchanged} unchanged.${s.errors.length ? ` ${s.errors.length} entries need attention: ${s.errors.join(' ')}` : ''}`
      )
      for (const queryKey of [['trackerStatus'], ['watchlist'], ['allContinueWatching']])
        queryClient.invalidateQueries({ queryKey })
    },
    onError: (err: Error) => setError(err.message),
  })
  const mal = status?.mal
  return (
    <div>
      <p>
        Connect your account for two-way anime list sync. Completed episodes automatically update
        MyAnimeList and AniList when connected.
      </p>
      {mal?.connected ? (
        <>
          <p>
            Connected as <strong>{mal.user?.name || 'MyAnimeList user'}</strong>
          </p>
          <div className={styles.inputGroup}>
            <Button
              onClick={() => {
                setError('')
                sync.mutate()
              }}
              loading={sync.isPending}
            >
              Sync Now
            </Button>
            <Button
              variant="secondary"
              onClick={() => disconnect.mutate()}
              loading={disconnect.isPending}
              disabled={sync.isPending}
            >
              Disconnect
            </Button>
          </div>
          <p>
            Progress merges keep the higher watched episode number. Sync does not delete entries
            from either library.
          </p>
        </>
      ) : (
        <>
          <p>
            Create an app at{' '}
            <a href="https://myanimelist.net/apiconfig" target="_blank" rel="noopener noreferrer">
              MyAnimeList API settings
            </a>
            . Use this exact redirect URL:
          </p>
          <p>
            <code>{window.location.origin}/trackers</code>
          </p>
          <div className={styles.inputGroup}>
            <label>
              Client ID
              <input
                className={styles.input}
                value={clientId}
                onChange={(e) => setClientId(e.currentTarget.value)}
                autoComplete="off"
              />
            </label>
            <label>
              Client secret (if required by your app type)
              <input
                className={styles.input}
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.currentTarget.value)}
                placeholder={
                  config?.hasSecret ? 'Saved — leave blank to keep' : 'Optional for a public app'
                }
                autoComplete="new-password"
              />
            </label>
          </div>
          <p>
            Public apps use PKCE without a client secret. App credentials are saved on your dango
            server; the secret is never returned to the browser.
          </p>
          <Button
            onClick={() => connect.mutate()}
            loading={connect.isPending || connecting}
            disabled={!clientId.trim()}
          >
            Connect to MyAnimeList
          </Button>
        </>
      )}
      {mal?.updates.pending ? (
        <p role="status">
          {mal.updates.pending} episode update(s) pending.{' '}
          {mal.updates.error || 'Updates retry automatically.'}
        </p>
      ) : null}
      {status?.anilist.updates.pending ? (
        <p role="status">
          AniList: {status.anilist.updates.pending} episode update(s) pending.{' '}
          {status.anilist.updates.error}
        </p>
      ) : null}
      {summary && <p role="status">{summary}</p>}
      {error && <p role="alert">{error}</p>}
      <hr />
      <p>You can also import a public list or XML file without connecting an account:</p>
    </div>
  )
}
