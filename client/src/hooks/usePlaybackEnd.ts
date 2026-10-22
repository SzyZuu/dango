import { useCallback, useEffect, useRef } from 'react'
import { isPlaybackEnded } from '../lib/playbackCompletion'

interface UsePlaybackEndOptions {
  videoRef: { current: HTMLVideoElement | null }
  sourceType?: string
  resetKey?: string | null
  onEnd: () => void
}

export function usePlaybackEnd({ videoRef, sourceType, resetKey, onEnd }: UsePlaybackEndOptions) {
  const endedRef = useRef(false)
  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd

  useEffect(() => {
    endedRef.current = false
  }, [resetKey])

  const logDuration = useCallback(() => {
    const duration = videoRef.current?.duration
    if (!duration || !Number.isFinite(duration)) return
    console.info(`[playback] duration ${duration.toFixed(2)}s`)
  }, [videoRef])

  const checkEnd = useCallback(
    (force = false) => {
      const video = videoRef.current
      if (!video || sourceType === 'iframe' || endedRef.current) return
      if (!force && !isPlaybackEnded(video.currentTime, video.duration)) return
      endedRef.current = true
      console.info(
        `[playback] end reached at ${video.currentTime.toFixed(2)}s / ${video.duration.toFixed(2)}s`
      )
      onEndRef.current()
    },
    [sourceType, videoRef]
  )

  return { checkEnd, logDuration }
}
