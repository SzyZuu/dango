import React from 'react'
import { Modal } from './Modal'
import { Button } from './Button'
import styles from './MatureConsentModal.module.css'

interface MatureConsentModalProps {
  isOpen: boolean
  onClose: () => void
  onGrant: () => void
  scope?: 'title' | 'section'
  showResetHint?: boolean
}

const MatureConsentModal: React.FC<MatureConsentModalProps> = ({
  isOpen,
  onClose,
  onGrant,
  scope = 'title',
  showResetHint = false,
}) => (
  <Modal isOpen={isOpen} title="Content Warning" onClose={onClose}>
    <div className={styles.body}>
      <p>This {scope} contains mature content intended for adult audiences.</p>
      <p>
        By proceeding, you confirm that you are <strong>18 years of age or older</strong> (or the
        age of majority in your jurisdiction) and wish to view this content.
      </p>
      {showResetHint && (
        <p className={styles.hint}>
          You can reset this preference at any time in the <strong>Settings</strong> page.
        </p>
      )}
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onClose}>
          Go Back
        </Button>
        <Button onClick={onGrant}>I&apos;m 18+, Continue</Button>
      </div>
    </div>
  </Modal>
)

export default MatureConsentModal
