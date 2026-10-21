import React, { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

interface ResetProgressModalProps {
  isOpen: boolean
  itemName?: string
  progressKind: 'watch' | 'reading' | 'listening'
  listLabel: string
  onClose: () => void
  onConfirm: (alsoRemoveFromList: boolean) => void
}

const ResetProgressModal: React.FC<ResetProgressModalProps> = ({
  isOpen,
  itemName,
  progressKind,
  listLabel,
  onClose,
  onConfirm,
}) => {
  const [alsoRemove, setAlsoRemove] = useState(false)

  useEffect(() => {
    if (isOpen) setAlsoRemove(false)
  }, [isOpen])

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        setAlsoRemove(false)
        onClose()
      }}
      title="Reset Progress"
    >
      <Modal.Body>
        <p>
          Are you sure you want to remove your {progressKind} progress for &quot;{itemName}&quot;?
        </p>
        <label>
          <input
            type="checkbox"
            checked={alsoRemove}
            onChange={(e) => setAlsoRemove(e.currentTarget.checked)}
          />
          Also remove from {listLabel}
        </label>
      </Modal.Body>
      <Modal.Actions>
        <Button
          variant="secondary"
          onClick={() => {
            setAlsoRemove(false)
            onClose()
          }}
        >
          No
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            const value = alsoRemove
            setAlsoRemove(false)
            onConfirm(value)
            onClose()
          }}
        >
          Yes
        </Button>
      </Modal.Actions>
    </Modal>
  )
}

export default ResetProgressModal
