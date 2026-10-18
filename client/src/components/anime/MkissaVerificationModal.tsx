import React from 'react'
import { Modal } from '../common/Modal'
import styles from './AnimePaheCookieModal.module.css'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

const MkissaVerificationModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const refresh = () => {
    onSuccess?.()
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="MKissa Browser Verification">
      <div className={styles.container}>
        <p>
          Open MKissa in this browser, play an anime episode, and complete any Cloudflare
          verification it shows. Once playback works there, return to Dango and click Refresh.
        </p>
        <div className={styles.actions}>
          <a
            className={styles.link}
            href="https://mkissa.to/anime"
            target="_blank"
            rel="noreferrer"
          >
            Open MKissa anime
          </a>
        </div>
        <div className={styles.actions}>
          <button className={styles.secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button className={styles.button} onClick={refresh}>
            Refresh Dango
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default MkissaVerificationModal
