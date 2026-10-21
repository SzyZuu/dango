import React from 'react'
import { useAsmrWork } from '../../hooks/useAsmr'
import type { AsmrPopupData } from '../../hooks/useAsmrPopup'
import MediaPopup from '../common/MediaPopup'
import type { MediaPopupMeta } from '../common/MediaPopup'

interface AsmrPopupProps {
  data: AsmrPopupData
  anchorRect: DOMRect
  bookmarked: boolean
  onToggleBookmark: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  onRequestClose?: () => void
}

const AsmrPopup: React.FC<AsmrPopupProps> = ({
  data,
  anchorRect,
  bookmarked,
  onToggleBookmark,
  onMouseEnter,
  onMouseLeave,
  onRequestClose,
}) => {
  const { data: detail, isLoading } = useAsmrWork(data.rjCode || null)

  const trackCount = detail?.tracks.length ?? 0
  const hasTracks = trackCount > 0
  const tracksReady = !isLoading

  const meta: MediaPopupMeta[] = [
    {
      icon: 'headphones',
      label: !tracksReady
        ? 'Loading tracks…'
        : hasTracks
          ? `${trackCount} track${trackCount === 1 ? '' : 's'}`
          : 'No tracks',
    },
  ]
  if (data.rating) meta.push({ label: data.rating.toUpperCase() })
  if (data.isAdult) meta.push({ label: '18+' })
  if (data.progressLabel) meta.push({ icon: 'bookmark', label: data.progressLabel })

  return (
    <MediaPopup
      anchorRect={anchorRect}
      title={data.title}
      subtitle={data.rjCode}
      cover={data.thumbnail}
      meta={meta}
      synopsis={
        !tracksReady && !detail?.description
          ? 'Loading description…'
          : (detail?.description ?? 'No description available.')
      }
      primaryAction={{
        to: data.listenTarget,
        label: hasTracks ? 'Listen now' : tracksReady ? 'No tracks' : 'Loading…',
        icon: 'play',
        disabled: !hasTracks,
      }}
      secondaryAction={{ to: data.listenTarget, label: 'Details' }}
      bookmarked={bookmarked}
      bookmarkLabel="Bookmark"
      onToggleBookmark={onToggleBookmark}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onRequestClose={onRequestClose}
    />
  )
}

export default AsmrPopup
