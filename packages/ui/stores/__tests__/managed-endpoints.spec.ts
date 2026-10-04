import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEndpointStore } from '../endpoint'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('managed endpoint discovery', () => {
  it('uses same-origin OAuth cookies and clears selection after scale-down', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 'managed-0', label: 'proxy-engine-0', url: '/instances/0' },
        { id: 'managed-2', label: 'proxy-engine-2', url: '/instances/2' },
      ],
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = useEndpointStore()
    store.addEndpoint({
      id: 'manual',
      url: 'http://localhost:9090',
      secret: 'example',
    })
    await store.refreshManagedEndpoints('/api/backends')
    expect(fetchMock).toHaveBeenCalledWith('/api/backends', {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    })
    expect(store.endpointList).toHaveLength(2)
    expect(store.endpointList.every((endpoint) => endpoint.secret === '')).toBe(
      true,
    )
    expect(store.endpointList[0]?.url).toBe(`${location.origin}/instances/0`)
    store.setSelectedEndpoint('managed-2')
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 'managed-0', label: 'proxy-engine-0', url: '/instances/0' },
      ],
    })
    await store.refreshManagedEndpoints('/api/backends')
    expect(store.selectedEndpoint).toBe('')
    expect(store.endpointList).toHaveLength(1)
  })

  it('retains the last discovered list with an error on failure; rejects foreign endpoints', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => [
          { id: 'managed-0', label: 'proxy-engine-0', url: '/instances/0' },
        ],
      })
    vi.stubGlobal('fetch', fetchMock)
    const store = useEndpointStore()
    await store.refreshManagedEndpoints('/api/backends')
    fetchMock.mockRejectedValue(new Error('Unavailable'))
    await store.refreshManagedEndpoints('/api/backends')
    expect(store.discoveryError).toBe(true)
    expect(store.endpointList).toHaveLength(1)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 'foreign', label: 'foreign', url: 'https://foreign.example' },
      ],
    })
    await store.refreshManagedEndpoints('/api/backends')
    expect(store.discoveryError).toBe(true)
    expect(store.endpointList[0]?.id).toBe('managed-0')
  })
})
