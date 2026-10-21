import React from 'react'
import styles from './ActiveFilterChips.module.css'

export interface FilterChip {
  key: string
  label: string
  tone?: 'secondary' | 'primary' | 'danger'
  onRemove: () => void
}

interface ActiveFilterChipsProps {
  chips: FilterChip[]
}

const ActiveFilterChips: React.FC<ActiveFilterChipsProps> = ({ chips }) => {
  if (chips.length === 0) return null
  return (
    <div className={styles.chips}>
      <span className={styles.label}>Active Filters:</span>
      {chips.map((chip) => (
        <span key={chip.key} className={`badge badge-${chip.tone ?? 'secondary'} ${styles.chip}`}>
          {chip.label}
          <button
            className={styles.remove}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              chip.onRemove()
            }}
            aria-label={`Remove ${chip.label}`}
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  )
}

export default ActiveFilterChips
