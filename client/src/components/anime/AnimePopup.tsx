import React, { useMemo } from 'react'
import { useAnimeInfoData } from '../../hooks/useAnimeInfoData'
import { sanitizeText } from '../../lib/utils'
import { useTitlePreference } from '../../contexts/TitlePreferenceContext'
import QueueOptionsButton from './QueueOptionsButton'
import MediaPopup from '../common/MediaPopup'
import popupStyles from '../common/MediaPopup.module.css'
import type { MediaPopupMeta } from '../common/MediaPopup'

interface AnimePopupProps {
  showId: string
  anchorRect: DOMRect
  onMouseEnter: () => void
  onMouseLeave: () => void
  onRequestClose?: () => void
}

const AnimePopup: React.FC<AnimePopupProps> = ({
  showId,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
  onRequestClose,
}) => {
  const { showMeta, loadingMeta, inWatchlist, toggleWatchlist } = useAnimeInfoData(showId)
  const { titlePreference } = useTitlePreference()

  const displayTitle = useMemo(() => {
    if (!showMeta?.name) return ''
    if (titlePreference === 'name') return showMeta.name
    if (titlePreference === 'nativeName') return showMeta.names?.native || showMeta.name
    if (titlePreference === 'englishName') return showMeta.names?.english || showMeta.name
    return showMeta.name
  }, [showMeta, titlePreference])

  const meta: MediaPopupMeta[] = []
  if (showMeta?.score) meta.push({ icon: 'star', label: String(showMeta.score), accent: true })
  if (showMeta?.status) meta.push({ icon: 'tv', label: showMeta.status })

  const genres =
    Array.isArray(showMeta?.genres) && showMeta.genres.length > 0
      ? showMeta.genres
          .filter(Boolean)
          .slice(0, 4)
          .map((g) => (typeof g === 'string' ? g : g?.name))
          .filter((name): name is string => !!name)
      : []

  return (
    <MediaPopup
      anchorRect={anchorRect}
      title={displayTitle}
      loading={loadingMeta}
      error={showMeta ? undefined : 'Failed to load info.'}
      meta={meta}
      genres={genres}
      synopsis={
        showMeta?.description ? sanitizeText(showMeta.description) : 'No synopsis available.'
      }
      primaryAction={{ to: `/watch/${showMeta?.id || showId}`, label: 'Watch now', icon: 'play' }}
      secondaryAction={{ to: `/anime/${showMeta?.id || showId}`, label: 'Read more' }}
      bookmarked={inWatchlist}
      onToggleBookmark={toggleWatchlist}
      extraActions={(onSubMenuOpenChange) =>
        showMeta ? (
          <QueueOptionsButton
            showId={showId}
            showName={showMeta.name || showMeta.names?.romaji}
            showThumbnail={showMeta.thumbnail}
            nativeName={showMeta.names?.native}
            englishName={showMeta.names?.english}
            showType={showMeta.type}
            className={popupStyles.watchlistBtn}
            activeClassName={popupStyles.active}
            align="left"
            onMenuOpenChange={onSubMenuOpenChange}
          />
        ) : null
      }
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onRequestClose={onRequestClose}
    />
  )
}

export default AnimePopup
