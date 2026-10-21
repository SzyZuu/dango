import { createContext, useContext } from 'react'

export interface AnimePaheCookieContextType {
  isOpen: boolean
  openModal: (onSuccess?: () => void) => void
  closeModal: () => void
  onSuccess?: () => void
}

export const AnimePaheCookieContext = createContext<AnimePaheCookieContextType | undefined>(
  undefined
)

export const useAnimePaheCookie = () => {
  const context = useContext(AnimePaheCookieContext)
  if (!context) {
    throw new Error('useAnimePaheCookie must be used within an AnimePaheCookieProvider')
  }
  return context
}
