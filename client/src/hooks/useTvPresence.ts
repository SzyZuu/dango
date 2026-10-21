import { useCallback, useEffect, useRef } from 'react'
import { clearDiscordPresence } from '../lib/trpcBeacon'
import { trpcClient } from '../lib/trpc'

interface UseTvPresenceOptions {
  details: { title: string; poster?: string; adult?: boolean } | null
  isMovie: boolean
  season: number
  episode: number
  videoRef: { current: HTMLVideoElement | null }
  active: boolean
}

// the discord presence of the tv player
export function useTvPresence({
  details,
  isMovie,
  season,
  episode,
  videoRef,
  active,
}: UseTvPresenceOptions) {
  const sessionRef = useRef<string>('')
  if (!sessionRef.current) {
    sessionRef.current = `tv-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  const sendPresence = useCallback(() => {
    if (!details) return
    const video = videoRef.current
    const episodeLabel = isMovie
      ? ''
      : `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
    trpcClient.discord.tvPresence
      .mutate({
        title: details.title,
        episodeLabel,
        isPlaying: video ? !video.paused && !video.ended : true,
        thumbnail: details.poster,
        currentTime: video ? video.currentTime : 0,
        duration: video ? video.duration || 0 : 0,
        isAdult: details.adult === true,
        sessionId: sessionRef.current,
      })
      .catch(() => {})
    trpcClient.discord.heartbeat.mutate({ sessionId: sessionRef.current }).catch(() => {})
  }, [details, isMovie, season, episode, videoRef])

  useEffect(() => {
    if (!details) return
    sendPresence()
    const timer = window.setInterval(() => {
      const video = videoRef.current
      if (!video || !video.paused) sendPresence()
    }, 15000)
    return () => window.clearInterval(timer)
  }, [sendPresence, details, videoRef])

  useEffect(() => {
    if (!details || !active) return
    const video = videoRef.current
    if (!video) return
    const send = () => sendPresence()
    video.addEventListener('play', send)
    video.addEventListener('pause', send)
    video.addEventListener('seeked', send)
    return () => {
      video.removeEventListener('play', send)
      video.removeEventListener('pause', send)
      video.removeEventListener('seeked', send)
    }
  }, [details, active, sendPresence, videoRef])

  useEffect(() => {
    const sessionId = sessionRef.current
    const clearTvPresence = () => clearDiscordPresence(sessionId)
    const handlePageHide = () => clearTvPresence()
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('beforeunload', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('beforeunload', handlePageHide)
      clearTvPresence()
    }
  }, [])

  return { sendPresence }
}
