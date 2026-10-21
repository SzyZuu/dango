import { createContext, useContext } from 'react'

export interface LanAuthContextType {
  isOpen: boolean
  openModal: () => void
  closeModal: () => void
}

export const LanAuthContext = createContext<LanAuthContextType | undefined>(undefined)

export const useLanAuth = () => {
  const context = useContext(LanAuthContext)
  if (!context) {
    throw new Error('useLanAuth must be used within a LanAuthProvider')
  }
  return context
}
