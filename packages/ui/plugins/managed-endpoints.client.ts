import { useEndpointStore } from '~/stores/endpoint'

export default defineNuxtPlugin(async () => {
  const config = (
    window as unknown as {
      __METACUBEXD_CONFIG__?: { backendDiscoveryURL?: string }
    }
  ).__METACUBEXD_CONFIG__
  const path = config?.backendDiscoveryURL
  if (!path) return
  const store = useEndpointStore()
  await store.refreshManagedEndpoints(path)
  const refresh = () => {
    void store.refreshManagedEndpoints(path)
  }
  const timer = window.setInterval(refresh, 30000)
  window.addEventListener('focus', refresh)
  watch(
    () => store.currentEndpoint,
    (endpoint) => {
      if (!endpoint) void navigateTo('/setup', { replace: true })
    },
  )
  if (import.meta.hot)
    import.meta.hot.dispose(() => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    })
})
