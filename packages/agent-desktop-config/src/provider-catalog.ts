import type {
  DesktopBackendProviderCatalogView,
  DesktopBackendProviderOption,
} from './types.js'

export const TELANCE_PROVIDER_PROXY_ORIGIN = 'http://127.0.0.1:8787'
const BROWSER_DIRECT_PROVIDER_IDS = new Set(['groq', 'google'])

export class DesktopBackendProviderCatalog {
  readonly #fetch: typeof fetch
  readonly #origin: string

  constructor(options: { fetch?: typeof fetch; origin?: string } = {}) {
    this.#fetch = options.fetch || fetch
    this.#origin = normalizeOrigin(options.origin || TELANCE_PROVIDER_PROXY_ORIGIN)
  }

  async getView(): Promise<DesktopBackendProviderCatalogView> {
    try {
      const response = await this.#fetch(`${this.#origin}/__proxy/providers`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(3_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json() as Record<string, unknown>
      const providers = normalizeProviders(payload.providers)
      return {
        source: 'telance-local-proxy',
        label: 'Chrome Extion 本机 Provider',
        available: payload.ok === true && providers.length > 0,
        activeProviderId: normalizedId(payload.activeProvider),
        providers,
      }
    } catch (error) {
      return {
        source: 'telance-local-proxy',
        label: 'Chrome Extion 本机 Provider',
        available: false,
        activeProviderId: '',
        providers: [],
        error: `本机 Provider 服务不可用：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  proxyBaseUrl(providerId: string) {
    const id = normalizedId(providerId)
    if (!id) throw new Error('Provider id is required')
    return `${this.#origin}/provider/${encodeURIComponent(id)}`
  }
}

function normalizeProviders(value: unknown): DesktopBackendProviderOption[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>)
    .map(([rawId, rawProvider]) => normalizeProvider(rawId, rawProvider))
    .filter((provider): provider is DesktopBackendProviderOption => Boolean(provider))
}

function normalizeProvider(rawId: string, value: unknown): DesktopBackendProviderOption | null {
  const id = normalizedId(rawId)
  if (!id || !value || typeof value !== 'object' || Array.isArray(value)) return null
  const provider = value as Record<string, unknown>
  const models = Array.isArray(provider.models)
    ? [...new Set(provider.models.map((model) => String(model || '').trim()).filter(Boolean))]
    : []
  if (!models.length) return null
  const requestedDefault = String(provider.defaultModel || '').trim()
  return {
    id,
    name: String(provider.name || id).trim() || id,
    models,
    defaultModel: models.includes(requestedDefault) ? requestedDefault : models[0],
    free: provider.free === true,
    configured: provider.configured === true,
    transport: BROWSER_DIRECT_PROVIDER_IDS.has(id) ? 'browser-direct' : 'loopback-proxy',
    desktopAvailable: provider.configured === true && !BROWSER_DIRECT_PROVIDER_IDS.has(id),
  }
}

function normalizedId(value: unknown) {
  const id = String(value || '').trim()
  return /^[A-Za-z0-9._-]+$/.test(id) ? id : ''
}

function normalizeOrigin(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('Desktop backend provider catalog must use a loopback HTTP origin')
  }
  url.pathname = ''
  url.search = ''
  url.hash = ''
  return url.origin
}
