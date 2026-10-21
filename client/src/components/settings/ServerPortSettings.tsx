import React, { useEffect, useState } from 'react'
import { Button } from '../common/Button'
import { trpcClient } from '../../lib/trpc'
import styles from './LanAuthSettings.module.css'

const ServerPortSettings: React.FC = () => {
  const [port, setPort] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    fetch('/api/auth/app-status')
      .then((res) => res.json())
      .then((data) => setPort(String(data.port ?? 3000)))
      .catch(() => setStatus('Failed to load current port'))
      .finally(() => setIsLoading(false))
  }, [])

  const handleSave = async () => {
    const value = Number(port)
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      setStatus('Enter a port between 1 and 65535')
      return
    }
    setIsSubmitting(true)
    setStatus('')
    try {
      await trpcClient.auth.setServerPort.mutate({ port: value })
      setStatus(
        `Saved. Restart dango, then open http://localhost:${value} - this overrides the PORT environment variable.`
      )
    } catch (err) {
      setStatus((err as Error).message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className={styles.sectionCard}>
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <div className={styles.sectionCard}>
      <h3>Server Port</h3>
      <p>
        Port the backend listens on. Takes effect after a restart. Google and AniList sign-in need
        the matching redirect URI registered with the provider.
      </p>

      <div className={styles.settingItem}>
        <div className={styles.field}>
          <label htmlFor="server-port">Port</label>
          <input
            id="server-port"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.currentTarget.value)}
            className={styles.input}
          />
        </div>
        <div className={styles.actions}>
          <Button
            variant="primary"
            onClick={handleSave}
            loading={isSubmitting}
            disabled={isSubmitting}
          >
            Save Port
          </Button>
        </div>
        {status && <p className={styles.status}>{status}</p>}
      </div>
    </div>
  )
}

export default ServerPortSettings
