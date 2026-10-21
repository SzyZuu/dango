import { createContext, useContext } from 'react'
export type TitlePreference = 'name' | 'nativeName' | 'englishName'
export type TitlePreferenceContextType = {
  titlePreference: TitlePreference
  setTitlePreference: (preference: TitlePreference) => void
  loading: boolean
}

export const TitlePreferenceContext = createContext<TitlePreferenceContextType | undefined>(
  undefined
)

export const useTitlePreference = (): TitlePreferenceContextType => {
  const context = useContext(TitlePreferenceContext)
  if (context === undefined) {
    throw new Error('useTitlePreference must be used within a TitlePreferenceProvider')
  }
  return context
}
