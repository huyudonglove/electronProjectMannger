import assert from 'node:assert/strict'
import test from 'node:test'

import { withProjectMemoryStatus } from '../dist/agent-memory-view.js'

test('project settings responses retain the bounded Memory status after route updates', () => {
  const view = {
    settingsRevision: 'settings-after-route-update',
    providerCatalog: { providers: [] },
    models: [],
    effectiveModelRoute: { routeId: 'route.updated', source: 'project', selections: [] },
  }
  const projectMemory = {
    enabled: true,
    profile: {
      id: 'memory.balanced',
      revision: '1',
      mode: 'balanced',
      sourceBudgets: { runFacts: 1, session: 2, project: 3, user: 4 },
    },
    sources: {
      total: 2,
      byKind: { constraints: 1, documents: 1, knowledge: 0 },
      byTrust: { trustedProject: 1, untrusted: 1 },
    },
  }
  const response = withProjectMemoryStatus(view, projectMemory)
  assert.equal(response.effectiveModelRoute.routeId, 'route.updated')
  assert.deepEqual(response.projectMemory, projectMemory)
  assert.equal(JSON.stringify(response).includes('content'), false)
})
