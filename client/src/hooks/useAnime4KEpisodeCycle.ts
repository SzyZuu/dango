import { useEffect, useRef } from 'react'

interface UseAnime4KEpisodeCycleOptions {
  videoRef: { current: HTMLVideoElement | null }
  episodeKey: string
  isEnabled: boolean
  isSupported: boolean
  mediaReady: boolean
  isIframeSource: boolean
  setEnabled: (next: boolean) => void
}

// the upscaler has to be rebuilt for every episode: it is turned off when the
// episode changes and turned back on when the new video is ready
export function useAnime4KEpisodeCycle({
  videoRef,
  episodeKey,
  isEnabled,
  isSupported,
  mediaReady,
  isIframeSource,
  setEnabled,
}: UseAnime4KEpisodeCycleOptions) {
  const prevEpisodeKeyRef = useRef<string | null>(null)
  const cyclePendingRef = useRef(false)
  const disableObservedRef = useRef(false)
  const setEnabledRef = useRef(setEnabled)
  setEnabledRef.current = setEnabled

  useEffect(() => {
    const prevKey = prevEpisodeKeyRef.current
    prevEpisodeKeyRef.current = episodeKey
    if (prevKey === null || prevKey === episodeKey) return
    if (!isEnabled || !isSupported) return
    cyclePendingRef.current = true
    disableObservedRef.current = false
    setEnabledRef.current(false)
  }, [episodeKey, isEnabled, isSupported])

  useEffect(() => {
    if (!cyclePendingRef.current) return
    if (isEnabled) {
      if (disableObservedRef.current) cyclePendingRef.current = false
      return
    }
    disableObservedRef.current = true
    if (!mediaReady) return
    if (isIframeSource) {
      cyclePendingRef.current = false
      setEnabledRef.current(true)
      return
    }
    const video = videoRef.current
    if (!video) return
    let timer: number | undefined
    let settled = false
    const reenable = () => {
      if (settled) return
      settled = true
      cyclePendingRef.current = false
      setEnabledRef.current(true)
    }
    if (video.readyState >= 2) {
      timer = window.setTimeout(reenable, 500)
      return () => window.clearTimeout(timer)
    }
    const onReady = () => {
      window.setTimeout(reenable, 500)
    }
    video.addEventListener('canplay', onReady, { once: true })
    video.addEventListener('playing', onReady, { once: true })
    timer = window.setTimeout(reenable, 5000)
    return () => {
      window.clearTimeout(timer)
      video.removeEventListener('canplay', onReady)
      video.removeEventListener('playing', onReady)
    }
  }, [isEnabled, mediaReady, isIframeSource, videoRef])
}
