import type { Endpoint } from '~/types'
import { defineStore } from 'pinia'

export const useEndpointStore = defineStore('endpoint', () => {
  // State
  const selectedEndpoint = useLocalStorage<string>('selectedEndpoint', '')
  const savedEndpoints = useLocalStorage<Endpoint[]>('endpointList', [])
  const managedMode = ref(false)
  const managedEndpoints = ref<Endpoint[]>([])
  const discoveryError = ref(false)
  const endpointList = computed({
    get: () =>
      managedMode.value ? managedEndpoints.value : savedEndpoints.value,
    set: (list: Endpoint[]) => {
      if (!managedMode.value) savedEndpoints.value = list
    },
  })

  async function refreshManagedEndpoints(path: string) {
    managedMode.value = true
    try {
      const response = await fetch(path, {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      })
      if (!response.ok) throw new Error('Discovery unavailable')
      const data: { id: string; label: string; url: string }[] =
        await response.json()
      if (
        !Array.isArray(data) ||
        data.some(
          (endpoint) =>
            typeof endpoint.id !== 'string' ||
            typeof endpoint.label !== 'string' ||
            typeof endpoint.url !== 'string' ||
            !/^\/instances\/\d+$/.test(endpoint.url),
        )
      ) {
        throw new Error('Invalid discovered endpoints')
      }
      managedEndpoints.value = data.map((endpoint) => ({
        ...endpoint,
        url: new URL(endpoint.url, window.location.origin).href,
        secret: '',
      }))
      if (
        !managedEndpoints.value.some(
          (endpoint) => endpoint.id === selectedEndpoint.value,
        )
      ) {
        selectedEndpoint.value = ''
      }
      discoveryError.value = false
    } catch {
      discoveryError.value = true
    }
  }

  // Getters
  const currentEndpoint = computed(() =>
    endpointList.value.find(({ id }) => id === selectedEndpoint.value),
  )

  const wsEndpointURL = computed(() => {
    const endpoint = currentEndpoint.value
    if (!endpoint) return ''
    try {
      const parsed = new URL(endpoint.url)
      if (parsed.protocol === 'http:') parsed.protocol = 'ws:'
      if (parsed.protocol === 'https:') parsed.protocol = 'wss:'
      const href = parsed.href
      return href.endsWith('/') ? href.slice(0, -1) : href
    } catch {
      return ''
    }
  })

  // Actions
  const setSelectedEndpoint = (id: string) => {
    selectedEndpoint.value = id
  }

  const setEndpointList = (list: Endpoint[]) => {
    endpointList.value = list
  }

  const addEndpoint = (endpoint: Endpoint) => {
    endpointList.value = [endpoint, ...endpointList.value]
  }

  const removeEndpoint = (id: string) => {
    endpointList.value = endpointList.value.filter((e) => e.id !== id)
    if (selectedEndpoint.value === id) {
      selectedEndpoint.value = ''
    }
  }

  const updateEndpoint = (id: string, updates: Partial<Endpoint>) => {
    const index = endpointList.value.findIndex((e) => e.id === id)
    const existing = endpointList.value[index]
    if (index !== -1 && existing) {
      endpointList.value[index] = { ...existing, ...updates } as Endpoint
    }
  }

  return {
    managedMode,
    discoveryError,
    refreshManagedEndpoints,
    selectedEndpoint,
    endpointList,
    currentEndpoint,
    wsEndpointURL,
    setSelectedEndpoint,
    setEndpointList,
    addEndpoint,
    removeEndpoint,
    updateEndpoint,
  }
})
