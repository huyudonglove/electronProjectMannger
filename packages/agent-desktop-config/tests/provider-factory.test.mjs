import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createBuiltinConfigLayer } from '@electron-manager/agent-config'

import {
  DesktopAgentSettingsStore,
  DesktopModelProviderFactory,
} from '../dist/index.js'

test('provider factory registers the independently configured summarizer route', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-provider-factory-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new DesktopAgentSettingsStore(path.join(root, 'settings.json'))
  const created = await store.loadOrCreate()
  const settings = await store.update(created.revision, (draft) => {
    const summaryProfile = {
      ...structuredClone(draft.catalog.modelProfiles[0]),
      id: 'desktop.model.openai.summarizer',
      revision: 'summary-v1',
      model: 'gpt-5.6-summary',
      credentialRef: 'credential.openai.summarizer',
    }
    draft.catalog.modelProfiles.push(summaryProfile)
    draft.catalog.modelRoutes.push({
      ...structuredClone(draft.catalog.modelRoutes[0]),
      id: 'desktop.route.summarizer',
      revision: 'summary-route-v1',
      primaryProfileId: summaryProfile.id,
      fallbackProfileIds: [],
    })
    draft.catalog.memoryProfiles[0].summarizerRouteId = 'desktop.route.summarizer'
    draft.providerSettings[summaryProfile.id] = {
      provider: 'openai',
      reasoningEffort: 'low',
      verbosity: 'low',
    }
  })
  const requestedCredentials = []
  const factory = new DesktopModelProviderFactory({
    credentials: {
      resolveCredential: async (ref) => {
        requestedCredentials.push(ref)
        return 'fixture-secret'
      },
    },
    openAITransportFactory: () => ({ async *stream() {} }),
  })

  const registrations = await factory.createRegistrations(
    settings,
    [createBuiltinConfigLayer(settings.catalog.modelRoutes[0].id)],
  )

  assert.deepEqual(
    registrations.map((registration) => registration.profileId).sort(),
    ['desktop.model.openai.default', 'desktop.model.openai.summarizer'],
  )
  assert.deepEqual(requestedCredentials.sort(), [
    'credential.openai.default',
    'credential.openai.summarizer',
  ])
})
