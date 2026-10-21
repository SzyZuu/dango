import React from 'react'
import ResetProgressModal from '../common/ResetProgressModal'
import { useRemoveMangaBookmark, useRemoveMangaProgress } from '../../hooks/useMangaLibrary'

interface MangaResetProgressModalProps {
  mangaId: string | null
  title?: string
  onClose: () => void
}

const MangaResetProgressModal: React.FC<MangaResetProgressModalProps> = ({
  mangaId,
  title,
  onClose,
}) => {
  const removeProgress = useRemoveMangaProgress()
  const removeBookmark = useRemoveMangaBookmark()

  return (
    <ResetProgressModal
      isOpen={!!mangaId}
      itemName={title}
      progressKind="reading"
      listLabel="my reading list"
      onClose={onClose}
      onConfirm={(alsoRemove) => {
        if (!mangaId) return
        removeProgress.mutate({ mangaId })
        if (alsoRemove) removeBookmark.mutate(mangaId)
      }}
    />
  )
}

export default MangaResetProgressModal
