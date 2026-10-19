import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createInitialState, loadPreferredProvider, savePreferredProvider } from './playerReducer'

describe('preferred provider', () => {
  const store = new Map<string, string>()
  const localStorageStub = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    clear: () => store.clear(),
  }

  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', localStorageStub)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('keeps anime and mature preferences separate', () => {
    savePreferredProvider('animepahe', false)
    savePreferredProvider('hn', true)
    expect(loadPreferredProvider(false)).toBe('animepahe')
    expect(loadPreferredProvider(true)).toBe('hn')
    expect(createInitialState().selectedProvider).toBe('animepahe')
  })

  it('keeps using the legacy anime key', () => {
    store.set('preferredProvider', 'megaplay')
    expect(createInitialState().selectedProvider).toBe('megaplay')
    expect(loadPreferredProvider(true)).toBeNull()
  })
})
