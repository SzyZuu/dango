// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import MalSyncNotice from './MalSyncNotice'

class FakeEventSource extends EventTarget {
  static latest: FakeEventSource
  close = vi.fn()
  constructor(_url: string) {
    super()
    FakeEventSource.latest = this
  }
  update(updating: boolean) {
    this.dispatchEvent(new MessageEvent('mal-update', { data: JSON.stringify({ updating }) }))
  }
}
let element: HTMLDivElement
const notice = () => document.querySelector('[role="status"]')
async function mount(enabled = true) {
  await act(async () => {
    render(<MalSyncNotice enabled={enabled} />, element)
  })
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('EventSource', FakeEventSource)
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
  element = document.createElement('div')
  document.body.appendChild(element)
})
afterEach(() => {
  act(() => render(null, element))
  element.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
describe('MAL update notice', () => {
  it('appears only for active updates and dismisses itself during a long request', async () => {
    await mount()
    act(() => FakeEventSource.latest.update(false))
    expect(notice()).toBeNull()
    act(() => FakeEventSource.latest.update(true))
    expect(notice()?.textContent).toContain('Updating MyAnimeList')
    act(() => {
      vi.advanceTimersByTime(2600)
    })
    expect(notice()).toBeNull()
  })
  it('stays quiet for a batch and allows a later independent update', async () => {
    await mount()
    act(() => FakeEventSource.latest.update(true))
    act(() => {
      vi.advanceTimersByTime(2600)
    })
    for (let i = 0; i < 3; i++) {
      act(() => {
        FakeEventSource.latest.update(false)
        vi.advanceTimersByTime(500)
        FakeEventSource.latest.update(true)
      })
    }
    expect(notice()).toBeNull()
    act(() => {
      FakeEventSource.latest.update(false)
      vi.advanceTimersByTime(10000)
      FakeEventSource.latest.update(true)
    })
    expect(notice()).not.toBeNull()
  })
  it('moves into the fullscreen player and cleans up when disabled', async () => {
    await mount()
    act(() => FakeEventSource.latest.update(true))
    const player = document.createElement('div')
    document.body.appendChild(player)
    Object.defineProperty(document, 'fullscreenElement', { value: player, configurable: true })
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(player.querySelector('[role="status"]')).not.toBeNull()
    const stream = FakeEventSource.latest
    await mount(false)
    expect(notice()).toBeNull()
    expect(stream.close).toHaveBeenCalledOnce()
    player.remove()
  })
  it('ignores malformed events and closes the connection on unmount', async () => {
    await mount()
    const stream = FakeEventSource.latest
    act(() => {
      stream.dispatchEvent(new MessageEvent('mal-update', { data: 'not json' }))
    })
    expect(notice()).toBeNull()
    act(() => render(null, element))
    expect(stream.close).toHaveBeenCalledOnce()
  })
})
