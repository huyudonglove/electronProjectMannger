import type { CredentialVault } from '@electron-manager/agent-credential-vault'

import { DesktopAgentSettingsStore } from './settings-store.js'
import type {
  DesktopAgentSettings,
  DesktopAgentSettingsView,
  DesktopModelCredentialDeleteInput,
  DesktopModelCredentialInput,
  DesktopOpenAIModelSettingsPatch,
} from './types.js'

const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
const VERBOSITIES = new Set(['low', 'medium', 'high'])

export class DesktopAgentSettingsService {
  readonly #store: DesktopAgentSettingsStore
  readonly #credentials: CredentialVault

  constructor(options: { store: DesktopAgentSettingsStore; credentials: CredentialVault }) {
    this.#store = options.store
    this.#credentials = options.credentials
  }

  async getView(): Promise<DesktopAgentSettingsView> {
    const settings = await this.#store.loadOrCreate()
    const refs = settings.catalog.modelProfiles.map((profile) => requireCredentialRef(profile.id, profile.credentialRef))
    const credentialSnapshot = await this.#credentials.inspect(refs)
    const credentialByRef = new Map(credentialSnapshot.credentials.map((credential) => [credential.ref, credential]))
    return {
      settingsRevision: settings.revision,
      credentialRevision: credentialSnapshot.revision,
      models: settings.catalog.modelProfiles.map((profile) => {
        if (profile.provider !== 'openai') throw new Error(`Unsupported desktop model provider: ${profile.provider}`)
        const provider = settings.providerSettings[profile.id]
        if (!provider || provider.provider !== 'openai') throw new Error(`OpenAI provider settings are missing: ${profile.id}`)
        const credentialRef = requireCredentialRef(profile.id, profile.credentialRef)
        const credential = credentialByRef.get(credentialRef)
        return {
          profileId: profile.id,
          provider: 'openai',
          model: profile.model,
          credentialRef,
          credentialConfigured: Boolean(credential?.configured),
          ...(credential?.updatedAt ? { credentialUpdatedAt: credential.updatedAt } : {}),
          ...(provider.organization ? { organization: provider.organization } : {}),
          ...(provider.project ? { project: provider.project } : {}),
          reasoningEffort: provider.reasoningEffort || 'medium',
          verbosity: provider.verbosity || 'low',
        }
      }),
    }
  }

  async updateOpenAIModel(input: DesktopOpenAIModelSettingsPatch): Promise<DesktopAgentSettingsView> {
    const reasoningEffort = String(input.reasoningEffort || '')
    const verbosity = String(input.verbosity || '')
    if (!REASONING_EFFORTS.has(reasoningEffort)) throw new Error(`Unsupported reasoning effort: ${reasoningEffort || 'empty'}`)
    if (!VERBOSITIES.has(verbosity)) throw new Error(`Unsupported response verbosity: ${verbosity || 'empty'}`)
    await this.#store.update(input.expectedRevision, (draft) => {
      requireOpenAIProfile(draft, input.profileId)
      const current = draft.providerSettings[input.profileId]
      draft.providerSettings[input.profileId] = {
        ...current,
        provider: 'openai',
        reasoningEffort: reasoningEffort as NonNullable<typeof current.reasoningEffort>,
        verbosity: verbosity as NonNullable<typeof current.verbosity>,
        ...optionalText('organization', input.organization),
        ...optionalText('project', input.project),
      }
      if (!input.organization?.trim()) delete draft.providerSettings[input.profileId].organization
      if (!input.project?.trim()) delete draft.providerSettings[input.profileId].project
    })
    return await this.getView()
  }

  async setModelCredential(input: DesktopModelCredentialInput): Promise<DesktopAgentSettingsView> {
    const settings = await this.#store.loadOrCreate()
    const profile = requireOpenAIProfile(settings, input.profileId)
    await this.#credentials.setCredential(
      requireCredentialRef(profile.id, profile.credentialRef),
      input.value,
      input.expectedCredentialRevision,
    )
    return await this.getView()
  }

  async deleteModelCredential(input: DesktopModelCredentialDeleteInput): Promise<DesktopAgentSettingsView> {
    const settings = await this.#store.loadOrCreate()
    const profile = requireOpenAIProfile(settings, input.profileId)
    await this.#credentials.deleteCredential(
      requireCredentialRef(profile.id, profile.credentialRef),
      input.expectedCredentialRevision,
    )
    return await this.getView()
  }
}

function requireOpenAIProfile(settings: Pick<DesktopAgentSettings, 'catalog'>, profileId: string) {
  const profile = settings.catalog.modelProfiles.find((candidate) => candidate.id === profileId)
  if (!profile) throw new Error(`Desktop model profile does not exist: ${profileId || 'empty'}`)
  if (profile.provider !== 'openai') throw new Error(`Unsupported desktop model provider: ${profile.provider}`)
  return profile
}

function requireCredentialRef(profileId: string, ref?: string) {
  if (!ref) throw new Error(`Model profile is missing credentialRef: ${profileId}`)
  return ref
}

function optionalText<Key extends 'organization' | 'project'>(key: Key, value?: string) {
  const text = String(value || '').trim()
  return text ? { [key]: text } as Record<Key, string> : {}
}
