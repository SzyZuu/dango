import React from 'react'
import ResetProgressModal from '../common/ResetProgressModal'
import { useRemoveAsmrBookmark, useRemoveAsmrProgress } from '../../hooks/useAsmrLibrary'

interface AsmrResetProgressModalProps {
  workId: string | null
  title?: string
  onClose: () => void
}

const AsmrResetProgressModal: React.FC<AsmrResetProgressModalProps> = ({
  workId,
  title,
  onClose,
}) => {
  const removeProgress = useRemoveAsmrProgress()
  const removeBookmark = useRemoveAsmrBookmark()

  return (
    <ResetProgressModal
      isOpen={!!workId}
      itemName={title}
      progressKind="listening"
      listLabel="my listening list"
      onClose={onClose}
      onConfirm={(alsoRemove) => {
        if (!workId) return
        removeProgress.mutate({ workId })
        if (alsoRemove) removeBookmark.mutate({ id: workId })
      }}
    />
  )
}

export default AsmrResetProgressModal
