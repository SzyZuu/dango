// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { useMalAuthCallback, MAL_OAUTH_STATE_KEY } from './useMalAuthCallback'
import { useAnilistAuthCallback } from './useAnilistAuthCallback'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  mal: vi.fn(),
  anilist: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('../lib/trpc', () => ({
  trpcClient: {
    tracker: { malAuth: { mutate: mocks.mal }, anilistAuth: { mutate: mocks.anilist } },
  },
}))
vi.mock('react-hot-toast', () => ({ default: { success: mocks.success, error: mocks.error } }))
let element: HTMLDivElement
function Callbacks() {
  useAnilistAuthCallback()
  useMalAuthCallback()
  return null
}
async function mount() {
  await act(async () => {
    render(<Callbacks />, element)
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  element = document.createElement('div')
  document.body.appendChild(element)
  sessionStorage.clear()
  window.history.replaceState(null, '', '/trackers')
  mocks.mal.mockResolvedValue({ user: { name: 'Test viewer' } })
})
afterEach(() => {
  render(null, element)
  element.remove()
})
describe('MyAnimeList callback', () => {
  it('exchanges a matching code once and never sends it to AniList', async () => {
    sessionStorage.setItem(MAL_OAUTH_STATE_KEY, 'mal:expected')
    window.history.replaceState(null, '', '/trackers?code=test-code&state=mal%3Aexpected')
    await mount()
    expect(mocks.mal).toHaveBeenCalledExactlyOnceWith({ code: 'test-code', state: 'mal:expected' })
    expect(mocks.anilist).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
    expect(sessionStorage.getItem(MAL_OAUTH_STATE_KEY)).toBeNull()
  })
  it('rejects an unexpected state without exchanging a code', async () => {
    sessionStorage.setItem(MAL_OAUTH_STATE_KEY, 'mal:expected')
    window.history.replaceState(null, '', '/trackers?code=test-code&state=mal%3Awrong')
    await mount()
    expect(mocks.mal).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalled()
  })
  it('handles authorization denial without contacting either tracker', async () => {
    sessionStorage.setItem(MAL_OAUTH_STATE_KEY, 'mal:expected')
    window.history.replaceState(null, '', '/trackers?error=access_denied&state=mal%3Aexpected')
    await mount()
    expect(mocks.mal).not.toHaveBeenCalled()
    expect(mocks.anilist).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalled()
  })
})
