import React from 'react'
import { useMangaDetail } from '../../hooks/useManga'
import { resolveMangaTitle } from '../../lib/manga'
import { useTitlePreference } from '../../contexts/TitlePreferenceContext'
import type { MangaPopupData } from '../../hooks/useMangaPopup'
import MediaPopup from '../common/MediaPopup'
import type { MediaPopupMeta } from '../common/MediaPopup'

interface MangaPopupProps {
  data: MangaPopupData
  anchorRect: DOMRect
  bookmarked: boolean
  onToggleBookmark: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  onRequestClose?: () => void
}

const MangaPopup: React.FC<MangaPopupProps> = ({
  data,
  anchorRect,
  bookmarked,
  onToggleBookmark,
  onMouseEnter,
  onMouseLeave,
  onRequestClose,
}) => {
  const { data: detail, isLoading } = useMangaDetail(
    data.provider,
    data.mangaId,
    data.rating || 'safe',
    data.mature || false
  )
  const { titlePreference } = useTitlePreference()

  const chapterCount = detail?.chapters.length ?? 0
  const displayTitle = resolveMangaTitle(
    { title: data.title, altTitle: detail?.altTitle ?? data.altTitle },
    titlePreference
  )

  const meta: MediaPopupMeta[] = []
  const status = [detail?.status, detail?.type].filter(Boolean).join(' · ')
  if (status) meta.push({ icon: 'book', label: status })
  if (chapterCount > 0) {
    meta.push({ label: `${chapterCount} chapter${chapterCount === 1 ? '' : 's'}` })
  }
  if (data.progressLabel) meta.push({ icon: 'bookmark', label: data.progressLabel })

  const genres = Array.isArray(detail?.genres)
    ? detail.genres
        .filter(Boolean)
        .slice(0, 4)
        .map((g) => g)
    : []

  return (
    <MediaPopup
      anchorRect={anchorRect}
      title={displayTitle}
      subtitle={
        detail?.altTitle && detail.altTitle !== displayTitle
          ? `Also known as: ${detail.altTitle}`
          : undefined
      }
      loading={isLoading}
      meta={meta}
      genres={genres}
      synopsis={detail?.description ? detail.description : 'No synopsis available.'}
      primaryAction={{ to: data.readTarget, label: 'Read now', icon: 'book' }}
      secondaryAction={{
        to: `/manga/${data.provider}/${encodeURIComponent(data.mangaId)}`,
        label: 'Read more',
      }}
      bookmarked={bookmarked}
      bookmarkLabel="Bookmark"
      onToggleBookmark={onToggleBookmark}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onRequestClose={onRequestClose}
    />
  )
}

export default MangaPopup
