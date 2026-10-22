import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import styles from './MalSyncNotice.module.css'

const NOTICE_DURATION = 2600
const NOTICE_COOLDOWN = 10000

export default function MalSyncNotice({ enabled = true }: { enabled?: boolean }) {
  const [visible, setVisible] = useState(false)
  const [fullscreen, setFullscreen] = useState<Element | null>(document.fullscreenElement)

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement)
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return
    const events = new EventSource('/api/tracker/mal/activity')
    let hide: ReturnType<typeof setTimeout> | undefined
    let idle: ReturnType<typeof setTimeout> | undefined
    let active = false
    let lastShown = -Infinity
    const updated = (event: MessageEvent<string>) => {
      let updating: unknown
      try {
        updating = JSON.parse(event.data).updating
      } catch {
        return
      }
      if (updating === true) {
        clearTimeout(idle)
        if (!active && Date.now() - lastShown >= NOTICE_COOLDOWN) {
          lastShown = Date.now()
          setVisible(true)
          clearTimeout(hide)
          hide = setTimeout(() => setVisible(false), NOTICE_DURATION)
        }
        active = true
      } else if (updating === false) {
        // Treat sequential writes in one list sync as a single quiet notification.
        clearTimeout(idle)
        idle = setTimeout(() => {
          active = false
        }, 1500)
      }
    }
    events.addEventListener('mal-update', updated as EventListener)
    return () => {
      events.removeEventListener('mal-update', updated as EventListener)
      events.close()
      clearTimeout(hide)
      clearTimeout(idle)
      setVisible(false)
    }
  }, [enabled])

  if (!enabled || !visible) return null
  return createPortal(
    <div className={styles.notice} role="status" aria-live="polite" aria-atomic="true">
      <Icon name="myanimelist" size={15} />
      <span>Updating MyAnimeList…</span>
    </div>,
    fullscreen || document.body
  )
}
