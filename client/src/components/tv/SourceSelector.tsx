import React from 'react'
import styles from '../player/SourceSelector.module.css'

interface Props {
  servers: string[]
  selectedServer: string
  onServerSelect: (server: string) => void
}

const TvSourceSelector: React.FC<Props> = ({ servers, selectedServer, onServerSelect }) => {
  if (servers.length === 0) return null

  return (
    <div className={styles.sourceSelectionContainer}>
      <h4>Source</h4>
      <div className={styles.sourceButtons}>
        {servers.map((server) => (
          <button
            key={server}
            className={`${styles.sourceButton} ${selectedServer === server ? styles.active : ''}`}
            onClick={() => onServerSelect(server)}
          >
            {server}
          </button>
        ))}
      </div>
    </div>
  )
}

export default React.memo(TvSourceSelector)
